import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getWeatherFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ lat: z.number(), lng: z.number() }))
  .handler(async ({ data }) => {
    const { getWeather } = await import("./weather.server");
    return getWeather(data.lat, data.lng);
  });
