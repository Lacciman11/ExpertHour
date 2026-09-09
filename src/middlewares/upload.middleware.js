import multer from "multer";

const storage = multer.memoryStorage();

const imageFileFilter = (req, file, cb) => {

    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

    if (allowedTypes.includes(file.mimetype)) {

        cb(null, true);

    } else {

        cb(new Error("Invalid file type. Only JPEG, PNG and WebP are allowed."), false);

    }

};

const cvFileFilter = (req, file, cb) => {

    const allowedTypes = [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];

    if (allowedTypes.includes(file.mimetype)) {

        cb(null, true);

    } else {

        cb(new Error("Invalid file type. Only PDF, DOC, and DOCX are allowed."), false);

    }

};

const upload = multer({

    storage,

    limits: {

        fileSize: 10 * 1024 * 1024, // 10MB

    },

});

const cvUpload = multer({

    storage,

    limits: {

        fileSize: 10 * 1024 * 1024, // 10MB

    },

    fileFilter: (req, file, cb) => {

        const allowedTypes = [
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ];

        if (allowedTypes.includes(file.mimetype)) {

            cb(null, true);

        } else {

            cb(new Error("Invalid file type. Only PDF, DOC, and DOCX are allowed."), false);

        }

    },

});

export const uploadAvatar = upload.single("avatar");

export const uploadCV = cvUpload.single("cv");
