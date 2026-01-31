"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

function safeFileName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // enlève les accents
    .replace(/[^a-zA-Z0-9._-]/g, "_"); // remplace espaces/symboles par _
}

export default function UploadTestPage() {
  const [status, setStatus] = useState("");
  const [publicUrl, setPublicUrl] = useState<string | null>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus("⏳ Upload en cours...");

    // ✅ Vérifie que tu es connectée (sinon RLS bloque l'upload)
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setStatus("❌ Tu dois être connectée pour uploader (policy Storage).");
      return;
    }

    const cleanName = safeFileName(file.name);

    // ✅ Option recommandée : ranger par user id (plus propre)
    const path = `test/${userData.user.id}/${Date.now()}-${cleanName}`;

    const { error } = await supabase.storage
      .from("drimli-public")
      .upload(path, file, { upsert: true });

    if (error) {
      setStatus("❌ Erreur : " + error.message);
      return;
    }

    const { data } = supabase.storage.from("drimli-public").getPublicUrl(path);

    setPublicUrl(data.publicUrl);
    setStatus("✅ Upload réussi !");
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Test upload (Supabase Storage)</h1>

      <input type="file" accept="image/*" onChange={handleUpload} />

      <p style={{ marginTop: 12 }}>{status}</p>

      {publicUrl && (
        <>
          <p>URL publique :</p>
          <a href={publicUrl} target="_blank" rel="noreferrer">
            {publicUrl}
          </a>

          <div style={{ marginTop: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={publicUrl}
              alt="preview"
              style={{
                width: 120,
                height: 120,
                objectFit: "cover",
                borderRadius: 12,
              }}
            />
          </div>
        </>
      )}
    </main>
  );
}
