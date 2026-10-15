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

const bookingDeclinedTemplate = ({ firstName }) => {

    const safeFirstName = escapeHtml(firstName || "there");

    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">

            <h2 style="color:#2563EB;">
                Booking Request Update
            </h2>

            <p>Hello ${safeFirstName},</p>

            <p>
                Unfortunately, the consultant is unable to accept your booking request at this time.
            </p>

            <p>
                You can browse other experts and submit a new request anytime on ExpertHour.
            </p>

        </div>
    `;
};

export default bookingDeclinedTemplate;
