import Category from "../models/Category.js";

class CategoryService {

    async create(data) {

        const category = await Category.create(data);

        return category;

    }

    async findAll(filters = {}) {

        const query = {};

        if (filters.isActive !== undefined) {

            query.isActive = filters.isActive;

        }

        if (filters.search) {

            query.name = { $regex: filters.search, $options: "i" };

        }

        const page = parseInt(filters.page) || 1;

        const limit = parseInt(filters.limit) || 10;

        const skip = (page - 1) * limit;

        const [categories, total] = await Promise.all([

            Category.find(query)

                .sort({ name: 1 })

                .skip(skip)

                .limit(limit),

            Category.countDocuments(query),

        ]);

        return {

            categories,

            total,

            page,

            limit,

            totalPages: Math.ceil(total / limit),

        };

    }

    async findById(id) {

        return await Category.findById(id);

    }

    async findByName(name) {

        return await Category.findOne({ name: { $regex: new RegExp(`^${name}$`, "i") } });

    }

    async update(id, data) {

        const category = await Category.findByIdAndUpdate(

            id,

            data,

            { new: true, runValidators: true }

        );

        return category;

    }

    async delete(id) {

        return await Category.findByIdAndDelete(id);

    }

}

export default new CategoryService();
