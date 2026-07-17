const escapeHtml = (value) =>
    String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

const forgotPasswordTemplate = ({ firstName, resetUrl }) => {

    const safeFirstName = escapeHtml(firstName || "there");

    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">

            <h2 style="color:#2563EB;">
                Reset Your Password
            </h2>

            <p>Hello ${safeFirstName},</p>

            <p>
                We received a request to reset your ExpertHour password.
            </p>

            <p>
                Click the button below to create a new password.
            </p>

            <p style="margin:30px 0;">

                <a
                    href="${resetUrl}"
                    style="
                        background:#2563EB;
                        color:#fff;
                        padding:14px 28px;
                        text-decoration:none;
                        border-radius:8px;
                        display:inline-block;
                    "
                >
                    Reset Password
                </a>

            </p>

            <p>
                This link will expire in 15 minutes.
            </p>

            <p>
                If you didn't request this, you can safely ignore this email.
            </p>

            <hr>

            <small>

                ExpertHour Team

            </small>

        </div>
    `;

};

export default forgotPasswordTemplate;