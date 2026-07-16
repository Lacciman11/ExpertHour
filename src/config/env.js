import dotenv from "dotenv";

dotenv.config();

const env = {
    port: process.env.PORT || 5000,

    nodeEnv: process.env.NODE_ENV,

    mongoURI: process.env.MONGO_URI,

    jwtAccessSecret: process.env.JWT_ACCESS_SECRET,

    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,

    jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN,

    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN,

    cloudinary: {
        cloudName: process.env.CLOUDINARY_CLOUD_NAME,
        apiKey: process.env.CLOUDINARY_API_KEY,
        apiSecret: process.env.CLOUDINARY_API_SECRET,
    },

    paystackSecret: process.env.PAYSTACK_SECRET_KEY,

    email: {
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        user: process.env.EMAIL_USER,
        password: process.env.EMAIL_PASSWORD,
    },
};

export default env;