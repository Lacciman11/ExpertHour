const escapeHtml = (value) =>
    String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");;

const paymentSuccessConsultantTemplate = ({ consultantName, clientName, date, time, duration, meetingLink }) => {

    const safeConsultantName = escapeHtml(consultantName || "Consultant");
    const safeClientName = escapeHtml(clientName || "Client");

    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">

            <h2 style="color:#10B981;">
                New Booking Confirmed
            </h2>

            <p>Hello ${safeConsultantName},</p>

            <p>
                You have a new confirmed session with <strong>${safeClientName}</strong>.
            </p>

            <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:16px; margin:20px 0;">
                <h3 style="color:#166534; margin-top:0;">Session Details</h3>
                <p><strong>Client:</strong> ${safeClientName}</p>
                <p><strong>Date:</strong> ${date}</p>
                <p><strong>Time:</strong> ${time}</p>
                <p><strong>Duration:</strong> ${duration} minutes</p>
            </div>

            <p style="margin:30px 0;">
                <a
                    href="${meetingLink}"
                    style="
                        background:#2563EB;
                        color:#fff;
                        padding:14px 28px;
                        text-decoration:none;
                        border-radius:8px;
                        display:inline-block;
                    "
                >
                    Join Google Meet
                </a>
            </p>

            <p>
                You can also copy the meeting link: <a href="${meetingLink}">${meetingLink}</a>
            </p>

            <hr>

            <small>
                ExpertHour Team
            </small>

        </div>
    `;

};

export default paymentSuccessConsultantTemplate;
