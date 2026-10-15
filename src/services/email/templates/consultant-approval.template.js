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

const consultantApprovalTemplate = ({ firstName }) => {

    const safeFirstName = escapeHtml(firstName || "there");

    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">

            <h2 style="color:#2563EB;">
                You're Approved
            </h2>

            <p>Hello ${safeFirstName},</p>

            <p>
                Great news — your ExpertHour consultant account has been approved.
            </p>

            <p>
                You can now receive bookings from clients on ExpertHour. Log in to your
                consultant dashboard to set up your availability and start taking sessions.
            </p>

            <p>
                Welcome aboard, and thank you for joining ExpertHour.
            </p>

        </div>
    `;
};

export default consultantApprovalTemplate;
