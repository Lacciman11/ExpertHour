import nodemailer from "nodemailer";
import env from "../../../config/env.js";
import dns from "dns";
import { promisify } from "util";

const lookup = promisify(dns.lookup);

const resolveIPv4 = async (hostname) => {

    try {

        const result = await lookup(hostname, { family: 4 });

        return result.address;

    } catch (error) {

        console.error("DNS lookup failed, falling back to hostname:", error.message);

        return hostname;

    }

};

let transporter = null;

const getTransporter = async () => {

    if (transporter) {

        return transporter;

    }

    const port = Number(env.email.port);

    const host = await resolveIPv4(env.email.host);

    transporter = nodemailer.createTransport({
        host,
        port,

        // Use implicit TLS only on 465; otherwise use STARTTLS (e.g. 587).
        secure: port === 465,
        requireTLS: port === 587,

        auth: {
            user: env.email.user,
            pass: env.email.password,
        },

        family: 4,

        tls: {
            servername: env.email.host,
        },

        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 15000,
    });

    return transporter;

};

export default getTransporter;
