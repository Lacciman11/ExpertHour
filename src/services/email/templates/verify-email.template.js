const verifyEmailTemplate = ({ firstName, verificationUrl }) => {

    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">

            <h2 style="color:#2563EB;">
                Verify Your Email
            </h2>

            <p>Hello ${firstName},</p>

            <p>
                Thank you for signing up for ExpertHour.
                Please verify your email address to activate your account.
            </p>

            <p style="margin:30px 0;">

                <a
                    href="${verificationUrl}"
                    style="
                        background:#2563EB;
                        color:#fff;
                        padding:14px 28px;
                        text-decoration:none;
                        border-radius:8px;
                        display:inline-block;
                    "
                >
                    Verify Email
                </a>

            </p>

            <p>
                This link will expire in 24 hours.
            </p>

            <p>
                If you didn't create an account, you can safely ignore this email.
            </p>

            <hr>

            <small>

                ExpertHour Team

            </small>

        </div>
    `;

};

export default verifyEmailTemplate;
