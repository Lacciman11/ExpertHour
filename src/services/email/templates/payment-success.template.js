const escapeHtml = (value) =>
    String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

const paymentSuccessTemplate = ({ clientName, consultantName, amount, date, time, duration, meetingLink, reference }) => {

    const safeClientName = escapeHtml(clientName || "Client");
    const safeConsultantName = escapeHtml(consultantName || "Consultant");

    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">

            <h2 style="color:#10B981;">
                Payment Successful!
            </h2>

            <p>Hello ${safeClientName},</p>

            <p>
                Your payment has been successfully processed and your session with <strong>${safeConsultantName}</strong> is now confirmed.
            </p>

            <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:16px; margin:20px 0;">
                <h3 style="color:#166534; margin-top:0;">Session Details</h3>
                <p><strong>Consultant:</strong> ${safeConsultantName}</p>
                <p><strong>Date:</strong> ${date}</p>
                <p><strong>Time:</strong> ${time}</p>
                <p><strong>Duration:</strong> ${duration} minutes</p>
                <p><strong>Amount Paid:</strong> $${amount}</p>
                <p><strong>Reference:</strong> ${reference}</p>
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

export default paymentSuccessTemplate;
