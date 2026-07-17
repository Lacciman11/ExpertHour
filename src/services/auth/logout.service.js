import sessionService from "../session.service.js";

class LogoutService {

    async execute(refreshToken) {

        if (!refreshToken) {

            return;

        }

        const session =
            await sessionService.findSession(refreshToken);

        if (!session) {

            return;

        }

        await sessionService.revokeSession(session._id);

    }

}


export default new LogoutService();
