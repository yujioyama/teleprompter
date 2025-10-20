import axios, { AxiosResponse } from "axios";
import L, { LatLngTuple } from "leaflet";

const form = document.querySelector("form");
const addressInput = document.getElementById("address")! as HTMLInputElement;

function searchAddressHandler(event: Event) {
  event.preventDefault();
  const enteredAdsress = addressInput.value;

  type NominatimResponse = { lat: number; lon: number };

  // send this to Google api
  axios
    .get<NominatimResponse[]>(
      `https://nominatim.openstreetmap.org/search?q=${enteredAdsress}&format=json&limit=1`
    )
    .then((response: AxiosResponse<NominatimResponse[]>) => {
      const { data, status } = response;
      const lat = data[0].lat;
      const lon = data[0].lon;

      if (status !== 200) {
        throw new Error("Could not fetch location!");
      }

      const coordinates: LatLngTuple = [lat, lon];

      var map = L.map("map").setView(coordinates, 13);

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
    })
    .catch((err) => {
      console.log(err.message);
    });
}

form?.addEventListener("submit", searchAddressHandler);

const a = (item: string | null, hasItem: boolean) => {
  if (hasItem) {
    item.split("");
  }
};
const item = localStorage.getItem("item");
const hasItem = item !== "" && item !== null;
a(item, hasItem);

const button = document.querySelector("#login-button");
const buttonUrl = new URL(button.href);
const params = new URLSearchParams(buttonUrl.search);
params.set("what", "fuck");
params.delete("apple");
const inr = "&apple=fluits,apple";
buttonUrl.search = params + inr;
button.href = buttonUrl.href;
