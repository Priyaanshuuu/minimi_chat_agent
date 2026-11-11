export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock implements Clock {
  private readonly currentTime: Date;

  constructor(currentTime: Date) {
    if (Number.isNaN(currentTime.getTime())) {
      throw new Error("Fixed clock requires a valid date");
    }

    this.currentTime = new Date(currentTime);
  }

  now(): Date {
    return new Date(this.currentTime);
  }
}
