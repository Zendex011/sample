/**
 * transformer.js - Complete Client-Side Data Transformation Pipeline
 * 
 * Combines all pipeline layers:
 * 1. OpenStreetMap (Overpass) Normalization
 * 2. Reverse Geocoding (with local address tag extraction & optional Nominatim fetch)
 * 3. Search Engine Routing (Google / Practo / Justdial)
 * 4. URL Generation
 * 5. Lead/CRM Field Enrichment
 */

const ROUTING_TABLE = {
    // Food & Beverage
    "restaurant": "google",
    "cafe": "google",
    "bar": "google",
    "fast_food": "google",
    "bakery": "google",
    "food_court": "google",

    // Health & Medical
    "clinic": "practo",
    "hospital": "practo",
    "doctor": "practo",
    "dentist": "practo",
    "pharmacy": "practo",
    "veterinary": "practo",

    // Fitness & Leisure
    "gym": "justdial",
    "fitness_centre": "justdial",
    "sports_centre": "justdial",

    // Retail / Services
    "supermarket": "justdial",
    "marketplace": "justdial",
    "laundry": "justdial",
    "car_wash": "justdial",
};

const DEFAULT_ENGINE = "google";

function routeCategory(category) {
    if (!category) return DEFAULT_ENGINE;
    return ROUTING_TABLE[category.toLowerCase().trim()] || DEFAULT_ENGINE;
}

function buildUrl(name, city, engine) {
    name = name || "";
    city = city || "";
    const cleanName = name.trim();
    const cleanCity = city.trim();

    if (engine === "practo") {
        // First word of name lowercased, stripped of non-alphanumeric characters
        const firstWord = cleanName.split(/\s+/)[0].toLowerCase();
        const slug = firstWord.replace(/[^a-z0-9]/g, "");
        const cityPart = cleanCity.toLowerCase().replace(/\s+/g, "-");
        return `https://www.practo.com/${cityPart}/hospitals-all/${slug}`;
    } else if (engine === "justdial") {
        // Preserve case, remove apostrophes, replace spaces with hyphens
        const slug = cleanName.replace(/'/g, "").replace(/\s+/g, "-");
        return `https://www.justdial.com/${cleanCity}/${slug}`;
    } else {
        // Google Search builder
        const query = `${cleanName} ${cleanCity}`.trim();
        return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    }
}

// In-memory cache for reverse geocoding to prevent excessive API requests
const geocodeCache = new Map();

async function reverseGeocode(lat, lon, tags = {}) {
    // 1. Try to extract from OpenStreetMap tags if available
    const city = tags["addr:city"] || tags["addr:suburb"] || tags["addr:town"] || tags["addr:village"] || "";
    const state = tags["addr:state"] || "";
    const country = tags["addr:country"] || "";

    if (city) {
        return { city, state, country };
    }

    // 2. Round coordinates to 2 decimal places to use cache key (~1km grid)
    const latRounded = Math.round(lat * 100) / 100;
    const lonRounded = Math.round(lon * 100) / 100;
    const cacheKey = `${latRounded},${lonRounded}`;

    if (geocodeCache.has(cacheKey)) {
        return geocodeCache.get(cacheKey);
    }

    // Default fallback
    const result = { city: "", state: "", country: "" };

    // 3. Optional: Call Nominatim (rate limited)
    try {
        // We add a small delay to respect Nominatim 1 req/sec limit if processing multiple items
        await new Promise(resolve => setTimeout(resolve, 1000));
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`, {
            headers: {
                "User-Agent": "leadflow_dashboard_client/1.0"
            }
        });
        if (response.ok) {
            const data = await response.json();
            const addr = data.address || {};
            result.city = addr.city || addr.town || addr.village || addr.suburb || "";
            result.state = addr.state || "";
            result.country = addr.country || "";
        }
    } catch (err) {
        console.warn(`Reverse geocoding failed for ${lat}, ${lon}:`, err);
    }

    geocodeCache.set(cacheKey, result);
    return result;
}

/**
 * Transforms any raw JSON array or dictionary from Overpass, preprocess, or pipeline
 * into the structured dashboard format.
 */
async function transformPipelineData(input) {
    let elements = [];

    // Detect structure: Overpass response has 'elements' key
    if (input && typeof input === "object" && !Array.isArray(input)) {
        if (Array.isArray(input.elements)) {
            elements = input.elements;
        } else {
            elements = [input];
        }
    } else if (Array.isArray(input)) {
        elements = input;
    }

    const transformed = [];

    for (let i = 0; i < elements.length; i++) {
        const item = elements[i];
        if (!item) continue;

        // Check if it's already processed by the pipeline (has location & search_url)
        if (item.location && item.search_url) {
            transformed.push({
                id: item.id ?? (i + 1),
                name: item.name || "Unnamed",
                category: item.category || "unknown",
                location: {
                    city: item.location.city || "",
                    state: item.location.state || "",
                    country: item.location.country || ""
                },
                search_engine: item.search_engine || "google",
                search_url: item.search_url,
                phone: item.phone || "",
                email: item.email || "",
                website: item.website || "",
                status: item.status || "Not Contacted",
                notes: item.notes || ""
            });
            continue;
        }

        // If it's raw OSM element or preprocessed record
        const tags = item.tags || {};
        const name = item.name || tags.name || "";
        if (!name) continue; // Skip elements without names

        // Determine coordinates
        const lat = parseFloat(item.lat || item.latitude || 0);
        const lon = parseFloat(item.lon || item.longitude || 0);

        // Category mapping
        const category = (
            item.category ||
            tags.amenity ||
            tags.shop ||
            tags.leisure ||
            tags.healthcare ||
            "unknown"
        ).toLowerCase().trim();

        // Get location via reverse geocoding
        let location = { city: "", state: "", country: "" };
        if (lat && lon) {
            location = await reverseGeocode(lat, lon, tags);
        }

        // Search engine routing & URL building
        const searchEngine = routeCategory(category);
        const searchUrl = buildUrl(name, location.city || "Chennai", searchEngine);

        transformed.push({
            id: item.id ?? (i + 1),
            name: name,
            category: category,
            location: location,
            search_engine: searchEngine,
            search_url: searchUrl,
            phone: item.phone || tags.phone || tags["contact:phone"] || "",
            email: item.email || tags.email || tags["contact:email"] || "",
            website: item.website || tags.website || tags["contact:website"] || "",
            status: item.status || "Not Contacted",
            notes: item.notes || ""
        });
    }

    return transformed;
}
window.transformPipelineData = transformPipelineData;
