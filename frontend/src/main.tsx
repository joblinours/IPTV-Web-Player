import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import AppShell from "./app/AppShell.tsx";
import { HomePage } from "./app/pages/HomePage.tsx";
import { MovieDetailsPage } from "./app/pages/MovieDetailsPage.tsx";
import { SeriesDetailsPage } from "./app/pages/SeriesDetailsPage.tsx";
import { SearchPage } from "./app/pages/SearchPage.tsx";
import { RequestsPage } from "./app/pages/RequestsPage.tsx";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/live" replace />} />
        <Route path="live" element={<HomePage />} />
        <Route path="films" element={<HomePage />} />
        <Route path="series" element={<HomePage />} />
        <Route path="movie/:accountId/:itemId" element={<MovieDetailsPage />} />
        <Route path="tv/:accountId/:seriesId" element={<SeriesDetailsPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="requests" element={<RequestsPage />} />
        <Route path="*" element={<Navigate to="/live" replace />} />
      </Route>
    </Routes>
  </BrowserRouter>
);
