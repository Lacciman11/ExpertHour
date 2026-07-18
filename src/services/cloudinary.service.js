import cloudinary from "../config/cloudinary.js";

class CloudinaryService {

    async uploadAvatar(file) {

        const result = await cloudinary.uploader.upload(
            `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
            {
                folder: "expert-hour/avatars",
                transformation: [
                    { width: 400, height: 400, crop: "fill", gravity: "face" },
                    { quality: "auto" },
                    { fetch_format: "auto" },
                ],
                resource_type: "image",
            }
        );

        return {

            url: result.secure_url,

            publicId: result.public_id,

        };

    }

    async deleteAvatar(publicId) {

        if (!publicId) {

            return;

        }

        await cloudinary.uploader.destroy(publicId);

    }

}


export default new CloudinaryService();
