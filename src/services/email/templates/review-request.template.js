// HTML entities are built by concatenation so the source never contains a
// literal entity token (which some editors/tools decode before writing).
const escapeHtml = (value) => {
    const entities = {
        "&": "&" + "amp;",
        "<": "&" + "lt;",
        ">": "&" + "gt;",
        '"': "&" + "quot;",
        "'": "&" + "#39;",
    };
    return String(value).replace(/[&<>"']/g, (char) => entities[char]);
};

/**
 * Review request email. Sent to the CLIENT one hour after their consultation
 * session is finalized as COMPLETED, inviting them to leave a review.
 *
 * Privacy: the payload carries only `firstName`. No consultant identity, no
 * rating, no review text, and no financial information of any kind.
 */
const reviewRequestTemplate = ({ firstName }) => {

    const safeFirstName = escapeHtml(firstName || "there");

    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">

            <h2 style="color:#2563EB;">
                How was your session?
            </h2>

            <p>Hello ${safeFirstName},</p>

            <p>
                Your ExpertHour consultation session has been completed. Your
                feedback helps other businesses find the right consultant and
                helps our experts improve.
            </p>

            <p>
                You can leave a review anytime by logging in to your ExpertHour
                dashboard and opening the booking.
            </p>

        </div>
    `;
};

export default reviewRequestTemplate;
