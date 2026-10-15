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
 * Booking reminder email. One safe template shared by the 24-hour and 1-hour
 * reminders; `reminderLabel` ("24 hours" / "1 hour") distinguishes them in the
 * body. No financial details or unnecessary participant information.
 */
const bookingReminderTemplate = ({ firstName, reminderLabel }) => {

    const safeFirstName = escapeHtml(firstName || "there");
    const safeLabel = escapeHtml(reminderLabel || "soon");

    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">

            <h2 style="color:#2563EB;">
                Session Reminder
            </h2>

            <p>Hello ${safeFirstName},</p>

            <p>
                This is a reminder that your ExpertHour consultation session starts
                in ${safeLabel}.
            </p>

            <p>
                You can view your booking details anytime by logging in to your
                ExpertHour dashboard.
            </p>

        </div>
    `;
};

export default bookingReminderTemplate;
