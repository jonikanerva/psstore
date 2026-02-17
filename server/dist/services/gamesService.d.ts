import { type Game } from '@psstore/shared';
export declare const getNewGames: () => Promise<Game[]>;
export declare const getUpcomingGames: () => Promise<Game[]>;
export declare const getDiscountedGames: () => Promise<Game[]>;
export declare const getPlusGames: () => Promise<Game[]>;
export declare const searchGames: (query: string) => Promise<Game[]>;
export declare const getGameById: (id: string) => Promise<Game>;
