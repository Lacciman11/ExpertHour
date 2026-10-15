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

const consultantRejectionTemplate = ({ firstName }) => {

    const safeFirstName = escapeHtml(firstName || "there");

    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">

            <h2 style="color:#2563EB;">
                Consultant Application Update
            </h2>

            <p>Hello ${safeFirstName},</p>

            <p>
                Thank you for your interest in becoming a consultant on ExpertHour.
            </p>

            <p>
                After reviewing your application, we're unable to approve your consultant
                account at this time.
            </p>

            <p>
                We appreciate the time you took to apply.
            </p>

        </div>
    `;
};

export default consultantRejectionTemplate;
