export type SendToParent = (data: Record<string, unknown>) => void;
export type Parent = {
    send: SendToParent | void;
};
export declare const parent: Parent;
export declare const connectingToServer: Promise<void | SendToParent>;
