const escapeHtml = (value) =>
    String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

const paymentFailureConsultantTemplate = ({ consultantName, clientName, date, time, reason }) => {

    const safeConsultantName = escapeHtml(consultantName || "Consultant");
    const safeClientName = escapeHtml(clientName || "Client");
    const safeReason = escapeHtml(reason || "Payment could not be processed");

    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">

            <h2 style="color:#EF4444;">
                Payment Failed
            </h2>

            <p>Hello ${safeConsultantName},</p>

            <p>
                We were unable to process the payment for the session with <strong>${safeClientName}</strong>.
            </p>

            <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:16px; margin:20px 0;">
                <h3 style="color:#991b1b; margin-top:0;">Booking Details</h3>
                <p><strong>Client:</strong> ${safeClientName}</p>
                <p><strong>Date:</strong> ${date}</p>
                <p><strong>Time:</strong> ${time}</p>
                <p><strong>Reason:</strong> ${safeReason}</p>
            </div>

            <p>
                The client has been notified. Please wait for them to retry or contact support if you believe this is an error.
            </p>

            <hr>

            <small>
                ExpertHour Team
            </small>

        </div>
    `;

};

export default paymentFailureConsultantTemplate;
