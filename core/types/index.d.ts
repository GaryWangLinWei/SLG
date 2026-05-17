export interface Point {
    x: number;
    y: number;
}
export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface ImageMatchResult {
    found: boolean;
    confidence: number;
    location: Point;
    rect: Rect;
}
export interface DeviceInfo {
    id: string;
    model: string;
    resolution: {
        width: number;
        height: number;
    };
}
