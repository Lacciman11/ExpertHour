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

    async uploadCV(file) {

        try {

            const extension = this._getExtension(file.mimetype);

            // Include the file extension in the public_id so Cloudinary
            // serves the file with the correct Content-Type.
            const publicId = extension
                ? `${Date.now()}_${Math.random().toString(36).slice(2)}.${extension}`
                : `${Date.now()}_${Math.random().toString(36).slice(2)}`;

            const result = await cloudinary.uploader.upload(
                `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
                {
                    folder: "expert-hour/cvs",
                    resource_type: "raw",
                    public_id: publicId,
                    access_mode: "public",
                }
            );

            return {

                url: result.secure_url,

                publicId: result.public_id,

            };

        } catch (error) {

            console.error("[CloudinaryService] CV upload failed:", error);

            throw new Error(`Failed to upload CV to Cloudinary: ${error.message}`);

        }

    }

    _getExtension(mimetype) {

        switch (mimetype) {

            case "application/pdf":
                return "pdf";

            case "application/msword":
                return "doc";

            case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
                return "docx";

            default:
                return "";

        }

    }

    async deleteAvatar(publicId) {

        if (!publicId) {

            return;

        }

        await cloudinary.uploader.destroy(publicId);

    }

    async deleteCV(publicId) {

        if (!publicId) {

            return;

        }

        await cloudinary.uploader.destroy(publicId, { resource_type: "raw" });

    }

}

export default new CloudinaryService();
