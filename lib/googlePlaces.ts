const GOOGLE_DOMAINS = new Set([
  "google.com",
  "google.be",
  "google.ca",
  "google.ch",
  "google.co.uk",
  "google.de",
  "google.es",
  "google.fr",
  "google.it",
  "google.lu",
  "google.nl",
  "google.pt",
  "google.sn",
]);
const MAX_REDIRECTS = 5;
const MAX_GOOGLE_PAGE_BYTES = 3_000_000;

type GoogleUrlFormat = "short_maps" | "maps_page" | "travel_hotel";

type ParsedGoogleUrl = {
  url: URL;
  format: GoogleUrlFormat;
};

export type GoogleBusinessPlace = {
  placeId: string;
  businessName: string;
  address: string | null;
  mapsUrl: string;
  rating: number | null;
  reviewsCount: number | null;
};

export class GooglePlacesError extends Error {
  constructor(
    public readonly code: "invalid_url" | "not_found" | "unavailable"
  ) {
    super(code);
  }
}

function isGoogleDomain(hostname: string) {
  const baseDomain = hostname.replace(/^(?:www|maps)\./, "");
  return GOOGLE_DOMAINS.has(baseDomain);
}

function parseAllowedMapsUrl(value: string): ParsedGoogleUrl {
  if (value.length > 2048) throw new GooglePlacesError("invalid_url");

  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw new GooglePlacesError("invalid_url");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const shortLink =
    hostname === "maps.app.goo.gl" ||
    (hostname === "goo.gl" && url.pathname.startsWith("/maps"));
  const relevantQuery = [
    "cid",
    "place_id",
    "query_place_id",
    "q",
    "query",
  ].some((parameter) => url.searchParams.has(parameter));
  const googleMapsPage =
    isGoogleDomain(hostname) &&
    (hostname.startsWith("maps.") ||
      url.pathname.startsWith("/maps") ||
      url.pathname.startsWith("/place/") ||
      url.pathname.startsWith("/local") ||
      relevantQuery);
  const googleTravelHotel =
    isGoogleDomain(hostname) && url.pathname.startsWith("/travel/hotels/");

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    (!shortLink && !googleMapsPage && !googleTravelHotel)
  ) {
    throw new GooglePlacesError("invalid_url");
  }

  return {
    url,
    format: shortLink
      ? "short_maps"
      : googleTravelHotel
        ? "travel_hotel"
        : "maps_page",
  };
}

async function readTextLimited(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let received = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    received += value.byteLength;
    if (received > MAX_GOOGLE_PAGE_BYTES) {
      await reader.cancel();
      throw new GooglePlacesError("not_found");
    }
    text += decoder.decode(value, { stream: true });
    if (/ChIJ[A-Za-z0-9_-]+/.test(text)) {
      await reader.cancel();
      return text;
    }
  }
}

async function resolveGoogleSource(initial: ParsedGoogleUrl) {
  let current = initial;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (current.format === "maps_page") {
      return { url: current.url, html: null };
    }

    let response: Response;
    try {
      response = await fetch(current.url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
        headers: { "User-Agent": "curl/8.7.1" },
      });
    } catch {
      throw new GooglePlacesError("unavailable");
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new GooglePlacesError("not_found");

      current = parseAllowedMapsUrl(
        new URL(location, current.url).toString()
      );
      continue;
    }

    if (response.ok && current.format === "travel_hotel") {
      return { url: current.url, html: await readTextLimited(response) };
    }

    throw new GooglePlacesError("not_found");
  }

  throw new GooglePlacesError("not_found");
}

function validPlaceId(value: string | null) {
  const normalized = value?.trim() ?? "";
  return /^[A-Za-z0-9_-]{10,300}$/.test(normalized) ? normalized : null;
}

function extractPlaceId(url: URL) {
  const fromQuery =
    validPlaceId(url.searchParams.get("query_place_id")) ||
    validPlaceId(url.searchParams.get("place_id"));
  if (fromQuery) return fromQuery;

  const decoded = decodeURIComponent(url.toString());
  const dataMatch = decoded.match(/!1s([^!/?&#]+)/);
  const fromData = validPlaceId(dataMatch?.[1] ?? null);
  if (fromData) return fromData;

  const queryMatch = decoded.match(/[?&]q=place_id:([^&]+)/i);
  return validPlaceId(queryMatch?.[1] ?? null);
}

function extractPlaceIdFromGooglePage(html: string | null) {
  if (!html) return null;
  return validPlaceId(html.match(/ChIJ[A-Za-z0-9_-]+/)?.[0] ?? null);
}

function extractTextQuery(url: URL) {
  const query = url.searchParams.get("query") || url.searchParams.get("q");
  if (query && !/^place_id:/i.test(query) && !/^-?\d+(\.\d+)?,-?\d/.test(query)) {
    return query.trim().slice(0, 240);
  }

  const match = decodeURIComponent(url.pathname).match(
    /\/(?:maps\/)?place\/([^/]+)/
  );
  return match?.[1]?.replace(/\+/g, " ").trim().slice(0, 240) || null;
}

function getApiKey() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!apiKey) throw new GooglePlacesError("unavailable");
  return apiKey;
}

async function searchPlaceId(textQuery: string) {
  let response: Response;
  try {
    response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": getApiKey(),
        "X-Goog-FieldMask": "places.id",
      },
      body: JSON.stringify({ textQuery, languageCode: "fr", maxResultCount: 1 }),
    });
  } catch {
    throw new GooglePlacesError("unavailable");
  }

  if (!response.ok) throw new GooglePlacesError("unavailable");
  const result = (await response.json()) as { places?: Array<{ id?: string }> };
  const placeId = validPlaceId(result.places?.[0]?.id ?? null);
  if (!placeId) throw new GooglePlacesError("not_found");
  return placeId;
}

export async function fetchGoogleBusinessPlace(
  placeId: string
): Promise<GoogleBusinessPlace> {
  const normalizedPlaceId = validPlaceId(placeId);
  if (!normalizedPlaceId) throw new GooglePlacesError("not_found");

  let response: Response;
  try {
    response = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(normalizedPlaceId)}`,
      {
        cache: "no-store",
        headers: {
          "X-Goog-Api-Key": getApiKey(),
          "X-Goog-FieldMask":
            "id,displayName,formattedAddress,googleMapsUri,rating,userRatingCount",
        },
      }
    );
  } catch {
    throw new GooglePlacesError("unavailable");
  }

  if (response.status === 404) throw new GooglePlacesError("not_found");
  if (!response.ok) throw new GooglePlacesError("unavailable");

  const place = (await response.json()) as {
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    googleMapsUri?: string;
    rating?: number;
    userRatingCount?: number;
  };
  const businessName = place.displayName?.text?.trim();
  const mapsUrl = place.googleMapsUri?.trim();

  if (!businessName || !mapsUrl || !validPlaceId(place.id ?? null)) {
    throw new GooglePlacesError("not_found");
  }

  return {
    placeId: place.id!,
    businessName,
    address: place.formattedAddress?.trim() || null,
    mapsUrl,
    rating: typeof place.rating === "number" ? place.rating : null,
    reviewsCount:
      typeof place.userRatingCount === "number" ? place.userRatingCount : null,
  };
}

export async function fetchGoogleReviewUrl(placeId: string) {
  const normalizedPlaceId = validPlaceId(placeId);
  if (!normalizedPlaceId) throw new GooglePlacesError("not_found");

  let response: Response;
  try {
    response = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(normalizedPlaceId)}`,
      {
        cache: "no-store",
        headers: {
          "X-Goog-Api-Key": getApiKey(),
          "X-Goog-FieldMask": "googleMapsLinks.writeAReviewUri",
        },
      }
    );
  } catch {
    throw new GooglePlacesError("unavailable");
  }

  if (response.status === 404) throw new GooglePlacesError("not_found");
  if (!response.ok) throw new GooglePlacesError("unavailable");

  const place = (await response.json()) as {
    googleMapsLinks?: { writeAReviewUri?: string };
  };
  const value = place.googleMapsLinks?.writeAReviewUri?.trim();

  try {
    const url = new URL(value ?? "");
    if (url.protocol !== "https:" || !isGoogleDomain(url.hostname)) {
      throw new Error("invalid review URL");
    }
    return url.toString();
  } catch {
    throw new GooglePlacesError("not_found");
  }
}

export async function searchGoogleBusinesses(
  query: string
): Promise<GoogleBusinessPlace[]> {
  const textQuery = query.trim().slice(0, 240);
  if (textQuery.length < 2) throw new GooglePlacesError("not_found");

  let response: Response;
  try {
    response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": getApiKey(),
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.rating,places.userRatingCount",
      },
      body: JSON.stringify({
        textQuery,
        languageCode: "fr",
        maxResultCount: 5,
      }),
    });
  } catch {
    throw new GooglePlacesError("unavailable");
  }

  if (!response.ok) throw new GooglePlacesError("unavailable");
  const result = (await response.json()) as {
    places?: Array<{
      id?: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      googleMapsUri?: string;
      rating?: number;
      userRatingCount?: number;
    }>;
  };

  return (result.places ?? []).flatMap((place) => {
    const placeId = validPlaceId(place.id ?? null);
    const businessName = place.displayName?.text?.trim();
    const mapsUrl = place.googleMapsUri?.trim();
    if (!placeId || !businessName || !mapsUrl) return [];
    return [{
      placeId,
      businessName,
      address: place.formattedAddress?.trim() || null,
      mapsUrl,
      rating: typeof place.rating === "number" ? place.rating : null,
      reviewsCount:
        typeof place.userRatingCount === "number"
          ? place.userRatingCount
          : null,
    }];
  });
}

export async function resolveGoogleBusiness(input: string) {
  const submittedUrl = parseAllowedMapsUrl(input);
  const source = await resolveGoogleSource(submittedUrl);
  const placeId =
    extractPlaceId(source.url) ||
    extractPlaceIdFromGooglePage(source.html) ||
    (await (async () => {
      const textQuery = extractTextQuery(source.url);
      if (!textQuery) throw new GooglePlacesError("not_found");
      return searchPlaceId(textQuery);
    })());

  return fetchGoogleBusinessPlace(placeId);
}
