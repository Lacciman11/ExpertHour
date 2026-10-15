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

const refundCompletedTemplate = ({ firstName }) => {

    const safeFirstName = escapeHtml(firstName || "there");

    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">

            <h2 style="color:#2563EB;">
                Refund Completed
            </h2>

            <p>Hello ${safeFirstName},</p>

            <p>
                Your refund has been completed and returned to your original payment method.
            </p>

            <p>
                You can view your bookings and payment activity anytime by logging in to
                your ExpertHour dashboard.
            </p>

        </div>
    `;
};

export default refundCompletedTemplate;
