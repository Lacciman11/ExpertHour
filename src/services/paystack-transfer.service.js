import { paystackClient } from "./payment.service.js";
import paymentLogger from "../utils/logger.js";
import ApiError from "../utils/ApiError.js";

// ---------------------------------------------------------------------------
// Paystack Transfer Service
//
// Wraps Paystack's Transfer API for:
//   1. Creating transfer recipients
//   2. Initiating transfers
//   3. Checking transfer status
//
// Reuses the existing PaystackClient (axios + retry + secret rotation).
// ---------------------------------------------------------------------------

/**
 * Normalized result for transfer operations.
 */
function normalizeTransferResult(data) {
    return {
        reference: data?.reference || null,
        transferCode: data?.transfer_code || data?.code || null,
        status: data?.status || null,
    };
}

/**
 * Normalized result for bank account resolution.
 */
function normalizeBankResolutionResult(data) {
    return {
        accountName: data?.account_name || null,
        accountNumber: data?.account_number || null,
        bankCode: data?.bank_code || null,
        details: data,
    };
}

/**
 * Create a Paystack transfer recipient.
 *
 * @param {object} params
 * @param {string} params.name - Recipient full name
 * @param {string} params.accountNumber - Bank account number
 * @param {string} params.bankCode - Paystack bank code
 * @param {string} [params.currency="NGN"] - Currency code
 * @returns {Promise<object>} Normalized result with recipient code
 */
async function createTransferRecipient({ name, accountNumber, bankCode, currency = "NGN" }) {
    if (!name || !accountNumber || !bankCode) {
        throw new ApiError(400, "name, accountNumber, and bankCode are required");
    }

    const payload = {
        type: "nuban",
        name,
        account_number: accountNumber,
        bank_code: bankCode,
        currency,
    };

    let response;
    try {
        response = await paystackClient.request("POST", "/transferrecipient", payload);
    } catch (error) {
        paymentLogger.error("paystack_transfer_recipient_failed", {
            event: "paystack_transfer_recipient_failed",
            error: error.message,
        });
        throw new ApiError(500, `Failed to create transfer recipient: ${error.message}`);
    }

    const data = response.data?.data;
    if (!data || !data.recipient_code) {
        throw new ApiError(500, "Paystack response missing recipient_code");
    }

    return {
        recipientCode: data.recipient_code,
        details: data,
    };
}

/**
 * Resolve a bank account via Paystack.
 *
 * @param {object} params
 * @param {string} params.accountNumber - Bank account number
 * @param {string} params.bankCode - Paystack bank code
 * @returns {Promise<object>} Normalized bank resolution result
 */
async function resolveBankAccount({ accountNumber, bankCode }) {
    if (!accountNumber || !bankCode) {
        throw new ApiError(400, "accountNumber and bankCode are required");
    }

    let response;
    try {
        const url = `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`;
        response = await paystackClient.request("GET", url);
    } catch (error) {
        paymentLogger.error("paystack_bank_resolve_failed", {
            event: "paystack_bank_resolve_failed",
            accountNumber,
            bankCode,
            error: error.message,
        });
        throw new ApiError(500, `Failed to resolve bank account: ${error.message}`);
    }

    const data = response.data?.data;
    if (!data || !data.account_name) {
        throw new ApiError(500, "Paystack response missing account_name");
    }

    return normalizeBankResolutionResult(data);
}

/**
 * Initiate a Paystack transfer.
 *
 * @param {object} params
 * @param {number} params.amount - Amount in kobo
 * @param {string} params.recipientCode - Paystack recipient code
 * @param {string} params.reference - Unique transfer reference (idempotency key)
 * @param {string} [params.reason="Consultant payout"] - Transfer reason
 * @returns {Promise<object>} Normalized transfer result
 */
async function initiateTransfer({ amount, recipientCode, reference, reason = "Consultant payout" }) {
    if (!recipientCode || !reference) {
        throw new ApiError(400, "recipientCode and reference are required");
    }

    if (typeof amount !== "number" || amount <= 0) {
        throw new ApiError(400, "amount must be a number greater than 0");
    }

    const payload = {
        amount,
        recipient: recipientCode,
        reference,
        reason,
        currency: "NGN",
    };

    let response;
    try {
        response = await paystackClient.request("POST", "/transfer", payload);
    } catch (error) {
        paymentLogger.error("paystack_transfer_initiation_failed", {
            event: "paystack_transfer_initiation_failed",
            reference,
            error: error.message,
        });
        throw new ApiError(500, `Failed to initiate transfer: ${error.message}`);
    }

    const data = response.data?.data;
    if (!data) {
        throw new ApiError(500, "Paystack response missing transfer data");
    }

    return normalizeTransferResult(data);
}

/**
 * Check the status of a Paystack transfer.
 *
 * @param {string} identifier - Paystack transfer code or reference
 * @returns {Promise<object>} Normalized transfer result
 */
async function checkTransferStatus(identifier) {
    if (!identifier) {
        throw new ApiError(400, "identifier (transfer code or reference) is required");
    }

    let response;
    try {
        response = await paystackClient.request("GET", `/transfer/verify/${encodeURIComponent(identifier)}`);
    } catch (error) {
        paymentLogger.error("paystack_transfer_status_failed", {
            event: "paystack_transfer_status_failed",
            identifier,
            error: error.message,
        });
        throw new ApiError(500, `Failed to check transfer status: ${error.message}`);
    }

    const data = response.data?.data;
    if (!data) {
        throw new ApiError(500, "Paystack response missing transfer data");
    }

    return normalizeTransferResult(data);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export { createTransferRecipient, resolveBankAccount, initiateTransfer, checkTransferStatus };

export default {
    createTransferRecipient,
    resolveBankAccount,
    initiateTransfer,
    checkTransferStatus,
};
