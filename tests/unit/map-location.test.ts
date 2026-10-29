import { describe, expect, it } from "vitest";
import { parseLocation } from "@/components/install/LiveMap";

describe("pasted site locations", () => {
  it("reads plain coordinates and common map links", () => {
    expect(parseLocation("28.4356, 77.1057")).toEqual({ latitude: 28.4356, longitude: 77.1057 });
    expect(parseLocation("https://www.google.com/maps/place/X/@28.4356,77.1057,17z")).toEqual({ latitude: 28.4356, longitude: 77.1057 });
    expect(parseLocation("https://www.google.com/maps/place/X/data=!3d12.9121!4d77.6446")).toEqual({ latitude: 12.9121, longitude: 77.6446 });
    expect(parseLocation("https://maps.google.com/?q=26.9118,75.74")).toEqual({ latitude: 26.9118, longitude: 75.74 });
    expect(parseLocation("https://www.openstreetmap.org/?mlat=28.524&mlon=77.354#map=16")).toEqual({ latitude: 28.524, longitude: 77.354 });
  });
  it("refuses text that is not a location", () => {
    expect(parseLocation("Sector 54, Gurugram")).toBeNull();
    expect(parseLocation("95, 77")).toBeNull();
  });
});
