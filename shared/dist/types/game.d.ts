export interface Game {
    id: string;
    name: string;
    date: string;
    url: string;
    price: string;
    discountDate: string;
    screenshots: string[];
    videos: string[];
    genres: string[];
    description: string;
    studio: string;
    preOrder: boolean;
}
export interface ErrorPayload {
    error: {
        code: string;
        message: string;
    };
}
