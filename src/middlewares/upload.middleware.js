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

const qualificationFileFilter = (req, file, cb) => {

    const allowedTypes = [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
    ];

    if (allowedTypes.includes(file.mimetype)) {

        cb(null, true);

    } else {

        cb(new Error("Invalid file type. Only PDF, DOC, DOCX, JPEG, PNG, and WebP are allowed."), false);

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

const qualificationsUpload = multer({

    storage,

    limits: {

        fileSize: 10 * 1024 * 1024, // 10MB

    },

    fileFilter: (req, file, cb) => {

        const allowedTypes = [
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/webp",
        ];

        if (allowedTypes.includes(file.mimetype)) {

            cb(null, true);

        } else {

            cb(new Error("Invalid file type. Only PDF, DOC, DOCX, JPEG, PNG, and WebP are allowed."), false);

        }

    },

});

const applicationUpload = multer({

    storage,

    limits: {

        fileSize: 10 * 1024 * 1024, // 10MB

    },

    fileFilter: (req, file, cb) => {

        if (file.fieldname === "cv") {

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

        } else if (file.fieldname === "qualifications") {

            const allowedTypes = [
                "application/pdf",
                "application/msword",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "image/jpeg",
                "image/jpg",
                "image/png",
                "image/webp",
            ];

            if (allowedTypes.includes(file.mimetype)) {

                cb(null, true);

            } else {

                cb(new Error("Invalid file type. Only PDF, DOC, DOCX, JPEG, PNG, and WebP are allowed."), false);

            }

        } else {

            cb(new Error("Unexpected file field"), false);

        }

    },

});

export const uploadAvatar = upload.single("avatar");

export const uploadCV = cvUpload.array("cv", 10);

export const uploadQualifications = qualificationsUpload.array("qualifications", 5);

export const uploadApplicationFiles = applicationUpload.fields([
    { name: "cv", maxCount: 10 },
    { name: "qualifications", maxCount: 5 },
]);
