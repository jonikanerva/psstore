export interface ProductMedia {
    url?: string;
    role?: string;
    type?: string;
}
export interface ProductPrice {
    basePrice?: string;
    discountedPrice?: string;
    discountText?: string | null;
}
export interface Product {
    id?: string;
    name?: string;
    releaseDate?: string;
    media?: ProductMedia[];
    price?: ProductPrice;
    genres?: string[];
    providerName?: string;
}
