import { v2 as cloudinary } from "cloudinary";

cloudinary.config({

    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,

    api_key: process.env.CLOUDINARY_API_KEY,

    api_secret: process.env.CLOUDINARY_API_SECRET,

});

const uploadCV = async (file) => {

    return new Promise((resolve, reject) => {

        const stream = cloudinary.uploader.upload_stream({

            resource_type: "raw",

            folder: "expert-hour/cvs",

        }, (error, result) => {

            if (error) {

                reject(error);

            } else {

                resolve({ url: result.secure_url, publicId: result.public_id });

            }

        });

        stream.end(file.buffer);

    });

};

const uploadQualification = async (file) => {

    return new Promise((resolve, reject) => {

        const stream = cloudinary.uploader.upload_stream({

            resource_type: "auto",

            folder: "expert-hour/qualifications",

        }, (error, result) => {

            if (error) {

                reject(error);

            } else {

                resolve({ url: result.secure_url, publicId: result.public_id });

            }

        });

        stream.end(file.buffer);

    });

};

const deleteFile = async (publicId) => {

    try {

        await cloudinary.uploader.destroy(publicId);

    } catch (error) {

        console.error("Error deleting file from Cloudinary:", error);

    }

};

export default {

    uploadCV,

    uploadQualification,

    deleteFile,

};
