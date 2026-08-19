/**
 * Shared Axios mock for payment service tests.
 *
 * In ESM, jest.mock() must be called at the top level before importing
 * the module that uses the mocked dependency.
 */

import { jest } from "@jest/globals";

const mockAxios = {
    get: jest.fn(),

    post: jest.fn(),

    request: jest.fn(),

};

// Default successful responses
mockAxios.get.mockResolvedValue({

    status: 200,

    data: {

        status: true,

        data: {

            id: 1234567890,

            status: "success",

            reference: "EXP-test-reference",

            amount: 500000,

            currency: "NGN",

            paid_at: new Date().toISOString(),

            channel: "card",

            gateway: "card",

            fees: 5000,

            customer: {

                id: 123,

                email: "test@example.com",

            },

        },

    },

});

mockAxios.post.mockResolvedValue({

    status: 200,

    data: {

        status: true,

        message: "Success",

        data: {

            id: 987654321,

            reference: "REF-test",

        },

    },

});

mockAxios.request.mockResolvedValue({

    status: 200,

    data: {

        status: true,

    },

});

// Mock the axios module (ESM requires default export wrapper)
jest.unstable_mockModule("axios", () => ({
    default: mockAxios,
}));

export default mockAxios;