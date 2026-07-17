import nodemailer from "nodemailer";
import env from "../../../config/env.js";

const port = Number(env.email.port);

const transporter = nodemailer.createTransport({
    host: env.email.host,
    port,

    // Use implicit TLS only on 465; otherwise use STARTTLS (e.g. 587).
    secure: port === 465,
    requireTLS: port === 587,

    auth: {
        user: env.email.user,
        pass: env.email.password,
    },

    family: 4,

    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
});

export default transporter;
