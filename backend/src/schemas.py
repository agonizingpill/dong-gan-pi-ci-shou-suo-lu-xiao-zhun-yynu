from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, StringConstraints, model_validator

from .models import Phase, Stage

Code = Annotated[str, StringConstraints(strip_whitespace=True, to_upper=True, pattern=r'^[A-Z0-9][A-Z0-9-]{1,31}$')]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=40)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, min_length=4, max_length=240)]
Positive = Annotated[FiniteFloat, Field(ge=0.00001, le=200)]
Percentage = Annotated[FiniteFloat, Field(ge=0, le=100)]


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Login(Input):
    username: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=1, max_length=120)


class RecipeIn(Input):
    code: Code
    product: str = Field(min_length=2, max_length=90)
    solids_pct: Percentage
    nominal_mm: Positive
    window_low: Percentage
    window_high: Percentage

    @model_validator(mode='after')
    def ordered_window(self):
        if self.window_low >= self.window_high:
            raise ValueError('工艺窗上限必须高于下限')
        return self


class BatchIn(Input):
    code: Code
    recipe_code: Code
    dryer: Name
    material_lot: Name
    feed_mm: Positive


class Point(Input):
    minute: int = Field(ge=0, le=10080)
    phase: Phase
    shelf_c: FiniteFloat = Field(ge=-100, le=100)
    pressure_pa: FiniteFloat = Field(ge=0.01, le=120000)


class CurveIn(Input):
    source_name: str = Field(min_length=5, max_length=96, pattern=r'^[a-zA-Z0-9_.-]+\.csv$')
    points: list[Point] = Field(min_length=2, max_length=500)

    @model_validator(mode='after')
    def increasing_minutes(self):
        minutes = [point.minute for point in self.points]
        if minutes != sorted(set(minutes)):
            raise ValueError('曲线采集分钟必须严格递增')
        return self


class SampleIn(Input):
    specimen: Code
    stage: Stage
    thickness_mm: Positive


class RetestIn(Input):
    specimen: Code
    before_mm: Positive
    after_mm: Positive
    note: Note

    @model_validator(mode='after')
    def no_expansion(self):
        if self.after_mm > self.before_mm:
            raise ValueError('复测厚度应小于或等于冻干前读数')
        return self


class DecisionIn(Input):
    note: Note
