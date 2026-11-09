//! swisstopo WMTS tile URLs for the GPX viewer. The URL is built only from the fixed host and the
//! `MapLayer` enum plus validated numeric coordinates, never from input strings.

use url::Url;

use crate::error::CoreError;

/// The only host tiles are fetched from.
pub const TILE_HOST: &str = "wmts.geo.admin.ch";
/// Highest zoom level we serve.
pub const MAX_ZOOM: u32 = 18;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MapLayer {
    Base,
    Grey,
    Winter,
    Aerial,
    Hiking,
    Slope,
    Skitour,
    Snowshoe,
    Mtb,
    Bike,
    Transit,
    Wildlife,
    Gamereserve,
}

/// Single source of truth: (layer, UI id, WMTS layer id, file extension).
/// The content type follows from the extension (`jpeg` or `png`).
const LAYERS: &[(MapLayer, &str, &str, &str)] = &[
    (MapLayer::Base, "base", "ch.swisstopo.pixelkarte-farbe", "jpeg"),
    (MapLayer::Grey, "grey", "ch.swisstopo.pixelkarte-grau", "jpeg"),
    (MapLayer::Winter, "winter", "ch.swisstopo.pixelkarte-farbe-winter", "jpeg"),
    (MapLayer::Aerial, "aerial", "ch.swisstopo.swissimage", "jpeg"),
    (MapLayer::Hiking, "hiking", "ch.swisstopo.swisstlm3d-wanderwege", "png"),
    (MapLayer::Slope, "slope", "ch.swisstopo.hangneigung-ueber_30", "png"),
    (MapLayer::Skitour, "skitour", "ch.swisstopo-karto.skitouren", "png"),
    (MapLayer::Snowshoe, "snowshoe", "ch.swisstopo-karto.schneeschuhrouten", "png"),
    (MapLayer::Mtb, "mtb", "ch.astra.mountainbikeland", "png"),
    (MapLayer::Bike, "bike", "ch.astra.veloland", "png"),
    (MapLayer::Transit, "transit", "ch.bav.haltestellen-oev", "png"),
    (MapLayer::Wildlife, "wildlife", "ch.bafu.wrz-wildruhezonen_portal", "png"),
    (MapLayer::Gamereserve, "gamereserve", "ch.bafu.bundesinventare-jagdbanngebiete", "png"),
];

impl MapLayer {
    fn row(self) -> &'static (MapLayer, &'static str, &'static str, &'static str) {
        LAYERS.iter().find(|r| r.0 == self).expect("every MapLayer has a LAYERS row")
    }

    pub fn parse(s: &str) -> Result<Self, CoreError> {
        LAYERS
            .iter()
            .find(|r| r.1 == s)
            .map(|r| r.0)
            .ok_or_else(|| CoreError::Invalid(format!("unbekannte Kartenebene: {s}")))
    }

    fn layer_id(self) -> &'static str {
        self.row().2
    }

    fn extension(self) -> &'static str {
        self.row().3
    }

    /// Content type the layer is expected to return.
    pub fn content_type(self) -> &'static str {
        if self.extension() == "jpeg" {
            "image/jpeg"
        } else {
            "image/png"
        }
    }
}

/// Validates the tile coordinates: `z <= 18`, `x` and `y` below `2^z`.
pub fn validate_tile(z: u32, x: u32, y: u32) -> Result<(), CoreError> {
    if z > MAX_ZOOM {
        return Err(CoreError::Invalid(format!("Zoomstufe {z} ausserhalb 0..={MAX_ZOOM}")));
    }
    let n = 1u32 << z;
    if x >= n || y >= n {
        return Err(CoreError::Invalid(format!("Kachel {x}/{y} ausserhalb des Bereichs für Zoom {z}")));
    }
    Ok(())
}

/// Builds the tile URL for a layer and validated coordinates.
pub fn tile_url(layer: MapLayer, z: u32, x: u32, y: u32) -> Result<Url, CoreError> {
    validate_tile(z, x, y)?;
    let s = format!(
        "https://{TILE_HOST}/1.0.0/{}/default/current/3857/{z}/{x}/{y}.{}",
        layer.layer_id(),
        layer.extension()
    );
    Url::parse(&s).map_err(|e| CoreError::InvalidUrl(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_layers() {
        assert_eq!(LAYERS.len(), 13);
        for (layer, id, _, _) in LAYERS {
            assert_eq!(MapLayer::parse(id).unwrap(), *layer);
        }
    }

    #[test]
    fn every_layer_builds_exact_url() {
        let expected = [
            ("base", "ch.swisstopo.pixelkarte-farbe", "jpeg"),
            ("grey", "ch.swisstopo.pixelkarte-grau", "jpeg"),
            ("winter", "ch.swisstopo.pixelkarte-farbe-winter", "jpeg"),
            ("aerial", "ch.swisstopo.swissimage", "jpeg"),
            ("hiking", "ch.swisstopo.swisstlm3d-wanderwege", "png"),
            ("slope", "ch.swisstopo.hangneigung-ueber_30", "png"),
            ("skitour", "ch.swisstopo-karto.skitouren", "png"),
            ("snowshoe", "ch.swisstopo-karto.schneeschuhrouten", "png"),
            ("mtb", "ch.astra.mountainbikeland", "png"),
            ("bike", "ch.astra.veloland", "png"),
            ("transit", "ch.bav.haltestellen-oev", "png"),
            ("wildlife", "ch.bafu.wrz-wildruhezonen_portal", "png"),
            ("gamereserve", "ch.bafu.bundesinventare-jagdbanngebiete", "png"),
        ];
        assert_eq!(expected.len(), LAYERS.len());
        for (id, wmts, ext) in expected {
            let layer = MapLayer::parse(id).unwrap();
            assert_eq!(
                tile_url(layer, 13, 4290, 2870).unwrap().as_str(),
                format!("https://wmts.geo.admin.ch/1.0.0/{wmts}/default/current/3857/13/4290/2870.{ext}")
            );
            let ct = if ext == "jpeg" { "image/jpeg" } else { "image/png" };
            assert_eq!(layer.content_type(), ct);
        }
    }

    #[test]
    fn rejects_unknown_layer() {
        assert!(MapLayer::parse("satellite").is_err());
        assert!(MapLayer::parse("").is_err());
        assert!(MapLayer::parse("Base").is_err());
        assert!(MapLayer::parse("../base").is_err());
    }

    #[test]
    fn rejects_zoom_above_18() {
        assert!(tile_url(MapLayer::Base, 18, 0, 0).is_ok());
        assert!(tile_url(MapLayer::Base, 19, 0, 0).is_err());
        assert!(tile_url(MapLayer::Base, 40, 0, 0).is_err());
    }

    #[test]
    fn rejects_out_of_range_coordinates() {
        assert!(tile_url(MapLayer::Base, 3, 7, 7).is_ok());
        assert!(tile_url(MapLayer::Base, 3, 8, 0).is_err());
        assert!(tile_url(MapLayer::Base, 3, 0, 8).is_err());
        assert!(tile_url(MapLayer::Base, 0, 1, 0).is_err());
    }

    #[test]
    fn content_types() {
        assert_eq!(MapLayer::Base.content_type(), "image/jpeg");
        assert_eq!(MapLayer::Slope.content_type(), "image/png");
    }

    #[test]
    fn host_is_fixed() {
        let u = tile_url(MapLayer::Hiking, 10, 1, 2).unwrap();
        assert_eq!(u.host_str(), Some(TILE_HOST));
        assert_eq!(u.scheme(), "https");
    }
}
