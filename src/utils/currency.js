/**
 * Currency utility functions for NGN/kobo conversion.
 *
 * Convention:
 *   - Storage: integer kobo (e.g., 2000000 = ₦20,000)
 *   - Display: Naira (e.g., 20000 = ₦20,000)
 */

/**
 * Convert kobo (integer) to Naira for display/API responses.
 * @param {number} kobo - Amount in kobo
 * @returns {number} Amount in Naira
 */
export function koboToNaira(kobo) {
    if (typeof kobo !== "number" || isNaN(kobo)) return 0;
    return Math.round(kobo / 100);
}

/**
 * Convert Naira to kobo for storage/Paystack API.
 * @param {number} naira - Amount in Naira
 * @returns {number} Amount in kobo (integer)
 */
export function nairaToKobo(naira) {
    if (typeof naira !== "number" || isNaN(naira)) return 0;
    return Math.round(naira * 100);
}
