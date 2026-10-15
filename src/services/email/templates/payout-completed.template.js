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

const payoutCompletedTemplate = ({ firstName }) => {

    const safeFirstName = escapeHtml(firstName || "there");

    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">

            <h2 style="color:#2563EB;">
                Payout Completed
            </h2>

            <p>Hello ${safeFirstName},</p>

            <p>
                Your payout has been completed.
            </p>

            <p>
                You can review your earnings and payout activity anytime by logging
                in to your ExpertHour consultant dashboard.
            </p>

        </div>
    `;
};

export default payoutCompletedTemplate;
