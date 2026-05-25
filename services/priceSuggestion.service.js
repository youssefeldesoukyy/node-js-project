/**
 * Resale price estimate via Groq (OpenAI-compatible chat API).
 * Env: GROQ_API_KEY (required). Optional: GROQ_MODEL, PRICE_SUGGESTION_CURRENCY (default EGP).
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const SYSTEM_PROMPT = `You help sellers price clothing and fashion resale items.
Respond with ONLY a JSON object (no markdown) with keys:
- minPrice: number (minimum fair listing price)
- maxPrice: number (maximum fair listing price, >= minPrice)
- suggestedPrice: number (optional midpoint or best single estimate)
- currency: string (same as requested currency code)
- reason: string (1–2 short sentences: brand + condition, and why the min–max span makes sense)

Prices must be realistic for the SECONDHAND/resale context in the requested currency (typical local resale listings).`;

function stripJsonFence(text) {
    const t = String(text).trim();
    const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    return m ? m[1].trim() : t;
}

function parseModelJson(raw) {
    const parsed = JSON.parse(stripJsonFence(raw));
    if (
        typeof parsed.minPrice !== "number" ||
        typeof parsed.maxPrice !== "number" ||
        typeof parsed.reason !== "string"
    ) {
        throw new Error("invalid AI response shape");
    }
    if (parsed.minPrice < 0 || parsed.maxPrice < 0 || parsed.minPrice > parsed.maxPrice) {
        throw new Error("invalid price range from AI");
    }
    const out = {
        minPrice: Math.round(parsed.minPrice * 100) / 100,
        maxPrice: Math.round(parsed.maxPrice * 100) / 100,
        currency: typeof parsed.currency === "string" ? parsed.currency : undefined,
        reason: parsed.reason.trim(),
    };
    if (typeof parsed.suggestedPrice === "number" && !Number.isNaN(parsed.suggestedPrice)) {
        out.suggestedPrice = Math.round(parsed.suggestedPrice * 100) / 100;
    }
    return out;
}

async function suggestPriceRange(input) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        const err = new Error("GROQ_API_KEY is not configured");
        err.code = "MISSING_AI_KEY";
        throw err;
    }

    const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
    const currency =
        process.env.PRICE_SUGGESTION_CURRENCY || input.currency || "EGP";

    const userPayload = JSON.stringify({
        brand: input.brand,
        productName: input.productName,
        material: input.material,
        condition: input.condition,
        currency,
        note: "Estimate a plausible secondhand/resale listing price range in the given currency (EGP = Egyptian Pound unless overridden).",
    });

    const res = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model,
            temperature: 0.4,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userPayload },
            ],
        }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg =
            data.error?.message || data.message || `Groq request failed (${res.status})`;
        const err = new Error(msg);
        err.code = "GROQ_ERROR";
        err.status = res.status;
        throw err;
    }

    const raw = data.choices?.[0]?.message?.content;
    if (!raw) {
        const err = new Error("Empty response from Groq");
        err.code = "GROQ_EMPTY";
        throw err;
    }

    try {
        const parsed = parseModelJson(raw);
        return { ...parsed, currency: parsed.currency || currency };
    } catch (e) {
        if (e.message === "invalid AI response shape" || e.message === "invalid price range from AI") {
            throw e;
        }
        const wrap = new Error("Groq returned invalid JSON");
        wrap.code = "GROQ_ERROR";
        wrap.status = 502;
        throw wrap;
    }
}

module.exports = { suggestPriceRange };
