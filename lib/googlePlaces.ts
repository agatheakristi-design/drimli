const SHORT_GOOGLE_MAPS_HOSTS = new Set(["maps.app.goo.gl", "goo.gl"]);
const MAX_REDIRECTS = 5;

export type GoogleBusinessPlace = {
  placeId: string;
  businessName: string;
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
  return new Set(["google.com", "www.google.com", "maps.google.com"]).has(
    hostname
  );
}

function parseAllowedMapsUrl(value: string) {
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
  const googleMapsPage =
    isGoogleDomain(hostname) &&
    (url.pathname.startsWith("/maps") ||
      url.pathname.startsWith("/local") ||
      url.searchParams.has("cid") ||
      url.searchParams.has("query_place_id"));

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    (!shortLink && !googleMapsPage)
  ) {
    throw new GooglePlacesError("invalid_url");
  }

  return url;
}

async function expandShortGoogleMapsUrl(initialUrl: URL) {
  let currentUrl = initialUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    parseAllowedMapsUrl(currentUrl.toString());

    if (!SHORT_GOOGLE_MAPS_HOSTS.has(currentUrl.hostname.toLowerCase())) {
      return currentUrl;
    }

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
        headers: { "User-Agent": "DRIMLI Google Business verifier" },
      });
    } catch {
      throw new GooglePlacesError("unavailable");
    }

    if (response.status < 300 || response.status >= 400) {
      throw new GooglePlacesError("not_found");
    }

    const location = response.headers.get("location");
    if (!location) throw new GooglePlacesError("not_found");

    currentUrl = parseAllowedMapsUrl(
      new URL(location, currentUrl).toString()
    );
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

function extractTextQuery(url: URL) {
  const query = url.searchParams.get("query") || url.searchParams.get("q");
  if (query && !/^place_id:/i.test(query) && !/^-?\d+(\.\d+)?,-?\d/.test(query)) {
    return query.trim().slice(0, 240);
  }

  const match = decodeURIComponent(url.pathname).match(/\/maps\/place\/([^/]+)/);
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

async function fetchPlaceDetails(placeId: string): Promise<GoogleBusinessPlace> {
  let response: Response;
  try {
    response = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        cache: "no-store",
        headers: {
          "X-Goog-Api-Key": getApiKey(),
          "X-Goog-FieldMask":
            "id,displayName,googleMapsUri,rating,userRatingCount",
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
    mapsUrl,
    rating: typeof place.rating === "number" ? place.rating : null,
    reviewsCount:
      typeof place.userRatingCount === "number" ? place.userRatingCount : null,
  };
}

export async function resolveGoogleBusiness(input: string) {
  const submittedUrl = parseAllowedMapsUrl(input);
  const expandedUrl = SHORT_GOOGLE_MAPS_HOSTS.has(submittedUrl.hostname.toLowerCase())
    ? await expandShortGoogleMapsUrl(submittedUrl)
    : submittedUrl;
  const placeId =
    extractPlaceId(expandedUrl) ||
    (await (async () => {
      const textQuery = extractTextQuery(expandedUrl);
      if (!textQuery) throw new GooglePlacesError("not_found");
      return searchPlaceId(textQuery);
    })());

  return fetchPlaceDetails(placeId);
}
