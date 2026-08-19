
export interface IServerConf {
    readonly http: {
        readonly port: number
    };
    readonly session: {
        readonly secret: string,
        readonly name: string
    };
    readonly cookie: {
        readonly secret: string,
        readonly policy: {
            readonly httpOnly: boolean,
            readonly maxAge?: number,
            readonly signed: boolean,
            readonly secure: boolean,
            readonly domain?: string
        }
    };
}
