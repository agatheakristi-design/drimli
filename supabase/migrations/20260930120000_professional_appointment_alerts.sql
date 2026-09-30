begin;

-- One durable event per confirmation/cancellation; one per existing audit row.
-- NULL means no event: existing appointments and audit history are not backfilled.
alter table public.appointments
  add column professional_confirmation jsonb,
  add column professional_client_cancellation jsonb;
alter table public.appointment_reschedule_audit
  add column actor text check (actor in ('client', 'professional')),
  add column professional_notification jsonb;

create index appointments_unseen_confirmation_idx on public.appointments(provider_id)
  where professional_confirmation is not null and professional_confirmation->>'seen_at' is null;
create index appointments_unseen_client_cancellation_idx on public.appointments(provider_id)
  where professional_client_cancellation is not null and professional_client_cancellation->>'seen_at' is null;
create index appointment_audit_unseen_client_idx on public.appointment_reschedule_audit(provider_id)
  where actor = 'client' and professional_notification is not null and professional_notification->>'seen_at' is null;

-- Snapshot email content when the event occurs, not when a later retry reads it.
create function public.appointment_alert_payload(p_id uuid, p_kind text)
returns jsonb language sql security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object(
    'kind', p_kind, 'occurred_at', clock_timestamp(), 'email_state', 'pending',
    'client_name', a.client_name, 'service_title', coalesce(p.title, 'Rendez-vous'),
    'provider_name', coalesce(nullif(btrim(pr.full_name), ''), 'Professionnel'),
    'recipient', coalesce(nullif(btrim(pr.email), ''), u.email),
    'start', a.start_datetime, 'end', a.end_datetime
  ) from public.appointments a
  left join public.products p on p.id = a.product_id
  left join public.profiles pr on pr.provider_id = a.provider_id
  left join auth.users u on u.id = a.provider_id
  where a.id = p_id;
$$;

create function public.capture_professional_confirmation()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.status = 'confirmed' and old.status = 'pending'
     and new.stripe_payment_intent_id is not null and new.professional_confirmation is null then
    update public.appointments set professional_confirmation =
      public.appointment_alert_payload(new.id, 'confirmed') where id = new.id;
  end if;
  return new;
end;
$$;
create trigger appointments_capture_professional_confirmation
  after update of status on public.appointments for each row
  execute function public.capture_professional_confirmation();

-- Explicit client provenance supplied only by trusted cancellation code, after
-- Stripe has reported a successful refund. The legacy status is not the actor.
create function public.record_client_cancellation_alert(p_id uuid, p_provider_id uuid, p_refund_id text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_refund_id is null or p_refund_id = '' then raise exception 'Missing refund reference'; end if;
  perform 1 from public.appointments where id = p_id and provider_id = p_provider_id for update;
  if not found then raise exception 'Appointment not found'; end if;
  update public.appointments set professional_client_cancellation =
    public.appointment_alert_payload(p_id, 'cancelled') || jsonb_build_object('actor', 'client', 'refund_id', p_refund_id)
    where id = p_id and professional_client_cancellation is null;
end;
$$;

create or replace function public.reschedule_appointment_with_alert(
  p_appointment_id uuid,
  p_provider_id uuid,
  p_expected_start timestamptz,
  p_new_start timestamptz,
  p_new_end timestamptz,
  p_now timestamptz,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare appointment_row public.appointments;
declare commitment_row public.drimli_payout_commitments;
declare audit_id uuid;
begin
  if p_actor not in ('client', 'professional') or p_actor is null then raise exception 'Invalid actor'; end if;
  select * into appointment_row from public.appointments
    where id = p_appointment_id and provider_id = p_provider_id for update;
  if appointment_row.id is null or appointment_row.status <> 'confirmed' then
    raise exception 'appointment is not movable';
  end if;
  if appointment_row.start_datetime is distinct from p_expected_start then
    raise exception 'appointment changed concurrently';
  end if;
  if p_new_start <= p_now or p_new_end <= p_new_start then
    raise exception 'invalid appointment range';
  end if;

  select * into commitment_row from public.drimli_payout_commitments
    where appointment_id = p_appointment_id for update;
  if commitment_row.id is not null then
    if commitment_row.status in ('reserved', 'submitted', 'paid', 'cancelled', 'refund_processing') then
      raise exception 'payment state prevents rescheduling';
    end if;
    if commitment_row.policy_snapshot in ('flexible', 'moderate')
       and p_new_end > commitment_row.created_at + interval '80 days' then
      raise exception 'refundable booking exceeds payout holding limit';
    end if;
  end if;

  if appointment_row.start_datetime = p_new_start and appointment_row.end_datetime = p_new_end then
    return to_jsonb(appointment_row) || jsonb_build_object('reschedule_event_id', null);
  end if;

  insert into public.appointment_reschedule_audit(
    appointment_id, provider_id, old_start_datetime, old_end_datetime,
    new_start_datetime, new_end_datetime, actor, professional_notification
  ) values (
    appointment_row.id, appointment_row.provider_id,
    appointment_row.start_datetime, appointment_row.end_datetime,
    p_new_start, p_new_end, p_actor,
    case when p_actor = 'client' then
      public.appointment_alert_payload(appointment_row.id, 'rescheduled') || jsonb_build_object(
        'old_start', appointment_row.start_datetime, 'old_end', appointment_row.end_datetime,
        'start', p_new_start, 'end', p_new_end
      ) else null end
  ) returning id into audit_id;

  update public.appointments
    set start_datetime = p_new_start, end_datetime = p_new_end
    where id = appointment_row.id
    returning * into appointment_row;

  update public.drimli_payout_commitments
    set eligible_at = case
          when policy_snapshot in ('flexible', 'moderate') then p_new_end + interval '15 minutes'
          else eligible_at
        end,
        updated_at = now()
    where appointment_id = appointment_row.id and status = 'pending';
  return to_jsonb(appointment_row) || jsonb_build_object('reschedule_event_id', audit_id);
end;
$$;

-- Preserve the existing cancellation status while recording client provenance
-- in the same transaction. Called only after the existing refund succeeds.
create function public.complete_client_cancellation_with_alert(p_id uuid, p_provider_id uuid, p_refund_id text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  update public.appointments set status = 'cancelled_by_provider'
    where id = p_id and provider_id = p_provider_id;
  if not found then raise exception 'Appointment not found'; end if;
  perform public.record_client_cancellation_alert(p_id, p_provider_id, p_refund_id);
end;
$$;

-- The old signature remains available for existing callers, with professional
-- provenance and no professional notification. No scheduling rules are changed.
create or replace function public.reschedule_paid_appointment_guarded(
  p_appointment_id uuid, p_provider_id uuid, p_expected_start timestamptz,
  p_new_start timestamptz, p_new_end timestamptz, p_now timestamptz
) returns public.appointments language plpgsql security definer set search_path = pg_catalog, public as $$
declare result public.appointments;
begin
  perform public.reschedule_appointment_with_alert(p_appointment_id, p_provider_id,
    p_expected_start, p_new_start, p_new_end, p_now, 'professional');
  select * into result from public.appointments where id = p_appointment_id;
  return result;
end;
$$;

-- Union existing storage; no generic notifications table and no public access.
create function public.professional_appointment_alerts(p_provider_id uuid)
returns table (event_id uuid, kind text, appointment_id uuid, payload jsonb)
language sql security definer set search_path = pg_catalog, public as $$
  select id, 'confirmed'::text, id, professional_confirmation from public.appointments
    where provider_id = p_provider_id and professional_confirmation is not null and professional_confirmation->>'seen_at' is null
  union all
  select id, 'cancelled'::text, id, professional_client_cancellation from public.appointments
    where provider_id = p_provider_id and professional_client_cancellation is not null and professional_client_cancellation->>'seen_at' is null
  union all
  select id, 'rescheduled'::text, appointment_id, professional_notification from public.appointment_reschedule_audit
    where provider_id = p_provider_id and actor = 'client' and professional_notification is not null and professional_notification->>'seen_at' is null;
$$;

-- A permanent claim deliberately favors no duplicate over automatic retries.
-- A failed/uncertain send is retained for manual investigation, never re-claimed.
create function public.claim_professional_appointment_email(p_kind text, p_event_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare tbl text; col text; result jsonb;
begin
  if p_kind = 'confirmed' then tbl := 'appointments'; col := 'professional_confirmation';
  elsif p_kind = 'cancelled' then tbl := 'appointments'; col := 'professional_client_cancellation';
  elsif p_kind = 'rescheduled' then tbl := 'appointment_reschedule_audit'; col := 'professional_notification';
  else raise exception 'Invalid event kind'; end if;
  execute format('update public.%I set %I = %I || jsonb_build_object(''email_state'', ''claimed'', ''email_claimed_at'', clock_timestamp()) where id = $1 and %I->>''email_state'' = ''pending'' returning %I', tbl, col, col, col, col)
    into result using p_event_id;
  return result;
end;
$$;

create function public.finish_professional_appointment_email(p_kind text, p_event_id uuid, p_state text, p_email_id text default null)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare tbl text; col text;
begin
  if p_state not in ('sent', 'failed', 'uncertain') then raise exception 'Invalid delivery state'; end if;
  if p_kind = 'confirmed' then tbl := 'appointments'; col := 'professional_confirmation';
  elsif p_kind = 'cancelled' then tbl := 'appointments'; col := 'professional_client_cancellation';
  elsif p_kind = 'rescheduled' then tbl := 'appointment_reschedule_audit'; col := 'professional_notification';
  else raise exception 'Invalid event kind'; end if;
  execute format('update public.%I set %I = %I || jsonb_build_object(''email_state'', $2, ''email_id'', $3, ''email_finished_at'', clock_timestamp()) where id = $1 and %I->>''email_state'' = ''claimed''', tbl, col, col, col)
    using p_event_id, p_state, p_email_id;
end;
$$;

-- Acknowledge only the exact event identities returned by the preceding GET.
create function public.mark_professional_appointment_alerts_seen(p_provider_id uuid, p_events jsonb)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  update public.appointments a set professional_confirmation = professional_confirmation || jsonb_build_object('seen_at', clock_timestamp())
    where a.provider_id = p_provider_id and professional_confirmation is not null and professional_confirmation->>'seen_at' is null
      and exists (select 1 from jsonb_to_recordset(p_events) as e(event_id uuid, kind text) where e.event_id = a.id and e.kind = 'confirmed');
  update public.appointments a set professional_client_cancellation = professional_client_cancellation || jsonb_build_object('seen_at', clock_timestamp())
    where a.provider_id = p_provider_id and professional_client_cancellation is not null and professional_client_cancellation->>'seen_at' is null
      and exists (select 1 from jsonb_to_recordset(p_events) as e(event_id uuid, kind text) where e.event_id = a.id and e.kind = 'cancelled');
  update public.appointment_reschedule_audit a set professional_notification = professional_notification || jsonb_build_object('seen_at', clock_timestamp())
    where a.provider_id = p_provider_id and professional_notification is not null and professional_notification->>'seen_at' is null
      and exists (select 1 from jsonb_to_recordset(p_events) as e(event_id uuid, kind text) where e.event_id = a.id and e.kind = 'rescheduled');
end;
$$;

-- Existing owners may read appointments, but cannot forge events or send state.
create function public.protect_professional_appointment_alerts()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    if tg_op = 'INSERT' then
      if new.professional_confirmation is not null or new.professional_client_cancellation is not null then
        raise exception 'Appointment alerts require trusted server code';
      end if;
    elsif new.professional_confirmation is distinct from old.professional_confirmation
       or new.professional_client_cancellation is distinct from old.professional_client_cancellation then
      raise exception 'Appointment alerts require trusted server code';
    end if;
  end if;
  return new;
end;
$$;
create trigger appointments_protect_professional_alerts before insert or update on public.appointments
  for each row execute function public.protect_professional_appointment_alerts();

revoke all on function public.appointment_alert_payload(uuid, text) from public, anon, authenticated;
grant execute on function public.appointment_alert_payload(uuid, text) to service_role;
revoke all on function public.capture_professional_confirmation() from public, anon, authenticated;
grant execute on function public.capture_professional_confirmation() to service_role;
revoke all on function public.record_client_cancellation_alert(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_client_cancellation_alert(uuid, uuid, text) to service_role;
revoke all on function public.reschedule_appointment_with_alert(uuid, uuid, timestamptz, timestamptz, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.reschedule_appointment_with_alert(uuid, uuid, timestamptz, timestamptz, timestamptz, timestamptz, text) to service_role;
revoke all on function public.professional_appointment_alerts(uuid) from public, anon, authenticated;
grant execute on function public.professional_appointment_alerts(uuid) to service_role;
revoke all on function public.claim_professional_appointment_email(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_professional_appointment_email(text, uuid) to service_role;
revoke all on function public.finish_professional_appointment_email(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.finish_professional_appointment_email(text, uuid, text, text) to service_role;
revoke all on function public.mark_professional_appointment_alerts_seen(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.mark_professional_appointment_alerts_seen(uuid, jsonb) to service_role;
revoke all on function public.protect_professional_appointment_alerts() from public, anon, authenticated;
grant execute on function public.protect_professional_appointment_alerts() to service_role;

revoke all on function public.complete_client_cancellation_with_alert(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.complete_client_cancellation_with_alert(uuid, uuid, text) to service_role;

commit;
