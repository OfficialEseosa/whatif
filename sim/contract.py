"""Pydantic mirror of src/lib/contract.ts (CONTRACT_VERSION 1.0.0).

Only what the sim reads or writes is typed tightly; sections the sim copies
through from the mock (verdict, whoPays, claims, personas, lookahead, impact
internals) are typed loosely as dicts. Keep field names identical to the TS.
The authoritative check is `node sim/validate_contract.mjs <file>` (real zod).
"""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

CONTRACT_VERSION = "1.0.0"

LngLat = tuple[float, float]
EditType = Literal["new_rail_line", "extend_line", "new_bus_route", "change_frequency",
                   "brt_lane", "new_road", "close_road", "congestion_charge"]
TransitTech = Literal["streetcar", "light_rail", "heavy_rail", "bus", "brt"]
Mode = Literal["drive", "transit", "park_ride"]
EarningsBand = Literal["low", "mid", "high"]


class _M(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Stop(_M):
    gazetteerId: str
    name: str
    coord: LngLat


class ScenarioEdit(_M):
    type: EditType
    name: str
    stops: list[Stop]
    corridor: Optional[list[str]] = None
    baseLineId: Optional[str] = None
    tech: Optional[TransitTech] = None
    headwayMin: Optional[float] = Field(default=None, gt=0)
    roadIds: Optional[list[str]] = None
    lanesRemoved: Optional[int] = Field(default=None, ge=0)
    chargeUsd: Optional[float] = Field(default=None, ge=0)
    chargeZone: Optional[list[LngLat]] = None
    assumptions: Optional[list[str]] = None


class Trip(_M):
    mode: Mode
    minutes: float = Field(ge=0)
    path: list[LngLat] = Field(min_length=2)
    timestamps: list[float]
    lines: Optional[list[str]] = None

    @model_validator(mode="after")
    def _len(self):
        if len(self.timestamps) != len(self.path):
            raise ValueError("timestamps must match path length")
        if any(t < 0 for t in self.timestamps):
            raise ValueError("timestamps must be >= 0")
        return self


class Stake(_M):
    minutesDelta: float
    rentPressure: bool
    noiseZone: bool
    costShareUsdYr: float = Field(ge=0)
    supportScore: float = Field(ge=-1, le=1)


class Agent(_M):
    id: str
    home: LngLat
    work: LngLat
    tractId: str
    earningsBand: EarningsBand
    renter: bool
    hasCar: bool
    baseline: Trip
    proposed: Trip
    stake: Stake
    displacementRisk: Literal["none", "year5", "year10"]


class ModelMetrics(_M):
    avgCommuteMin: float
    transitShare: float = Field(ge=0, le=1)
    dailyTransitRiders: float = Field(ge=0)
    populationModeled: int = Field(ge=0)
    displaySampleSize: int = Field(ge=0)


class RoadEffect(_M):
    roadId: str
    vcBaseline: float = Field(ge=0)
    vcProposed: float = Field(ge=0)
    delayDeltaMin: float


class TractEffect(_M):
    id: str
    name: Optional[str] = None
    centroid: LngLat
    polygon: Optional[list[LngLat]] = None
    minutesDelta: float
    redlined: bool
    rentPressure: bool
    renterShare: Optional[float] = None
    households: Optional[int] = None


class Line(_M):
    path: list[LngLat]
    stops: list[Stop]


class Metrics(_M):
    baseline: ModelMetrics
    proposed: ModelMetrics


class TimeWindow(_M):
    startSec: float
    endSec: float


class ScenarioResult(_M):
    id: str
    contractVersion: str
    title: str
    edit: ScenarioEdit
    isMock: bool
    generatedAt: str
    timeWindow: TimeWindow
    line: Line
    networkUrl: str
    network: Optional[dict[str, Any]] = None
    metrics: Metrics
    verdict: dict[str, Any]
    impact: dict[str, Any]
    agents: list[Agent]
    roads: list[RoadEffect]
    tracts: list[TractEffect]
    whoPays: dict[str, Any]
    claims: list[dict[str, Any]]
    personas: list[dict[str, Any]]
    lookahead: dict[str, Any]

    @field_validator("verdict")
    @classmethod
    def _five_tests(cls, v):
        if len(v.get("tests", [])) != 5:
            raise ValueError("verdict.tests must have exactly 5 entries")
        return v


class SimulateRequest(_M):
    edit: ScenarioEdit
    claims: Optional[list[dict[str, Any]]] = None
