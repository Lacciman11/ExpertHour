import env from "../../config/env.js";
import getTransporter from "./providers/nodemailer.provider.js";

class EmailService {

    async send({

        to,

        subject,

        html,

    }) {

        try {

            const transporter = await getTransporter();

            return await transporter.sendMail({

                from: env.email.from,

                to,

                subject,

                html,

            });

        } catch (error) {

            console.error("Email Error");

            console.error(error);

            throw error;

        }

    }

}

export default new EmailService();