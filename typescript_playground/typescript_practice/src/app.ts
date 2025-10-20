// function Logger(constructor: Function) {
//   console.log("Logging...");
//   console.log(constructor, " コンストラクター");
// }

// define factory function
function Logger(logString: string) {
  console.log("LOGGER FACTORY");
  return function (constructor: Function) {
    console.log(logString);
    console.log(constructor, " コンストラクター");
  };
}

function WithTemplate(template: string, hookId: string) {
  console.log("TEMPLATE FACTORY");
  return function <T extends { new (...args: any[]): { name: string } }>(
    originalConstructor: T,
  ) {
    return class extends originalConstructor {
      constructor(..._: any[]) {
        super();
        console.log("Rendering template");
        const hookEl = document.getElementById(hookId);
        if (hookEl) {
          hookEl.innerHTML = template;
          hookEl.querySelector("h1")!.textContent = this.name;
        }
      }
    };
  };
}

// @Logger

// execute factory function
@Logger("LOGGING - PERSON")
@WithTemplate("<h1>My Person object</h1>", "app")
class PersonInDecorator {
  name = "Max";

  constructor() {
    console.log("Createing person object...");
  }
}

// const per = new PersonInDecorator();

// console.log(per);

// ---

function Log(target: any, propertyName: string | symbol) {
  console.log("Property decorator!");
  console.log(target, propertyName);
}

function Log2(target: any, name: string, descriptor: PropertyDescriptor) {
  console.log("Accessor decorator!");
  console.log(target);
  console.log(name);
  console.log(descriptor);
}

function Log3(
  target: any,
  name: string | symbol,
  descriptor: PropertyDescriptor,
) {
  console.log("Method decorator!");
  console.log(target);
  console.log(name);
  console.log(descriptor);
}

function Log4(target: any, name: string | symbol, position: number) {
  console.log("Parameter decorator!");
  console.log(target);
  console.log(name);
  console.log(position);
}

class Product {
  @Log
  title: string;
  private _price: number;

  @Log2
  set price(val: number) {
    if (val > 0) {
      this._price = val;
    } else {
      throw new Error("Invalid price - should be positive!");
    }
  }

  constructor(t: string, p: number) {
    this.title = t;
    this._price = p;
  }

  @Log3
  getPriceWithTax(@Log4 tax: number) {
    return this._price * (1 + tax);
  }
}

function Autobind(_: any, _2: string, descriptor: PropertyDescriptor) {
  const originalMethod = descriptor.value;
  const adjDescriptor: PropertyDescriptor = {
    configurable: true,
    enumerable: false,
    get() {
      const boundFn = originalMethod.bind(this);
      return boundFn;
    },
  };

  return adjDescriptor;
}

class Printer {
  message = "This works!";

  @Autobind
  showMessage() {
    console.log(this.message);
  }
}

const p = new Printer();

const button = document.querySelector("button");

// このままだと.showMessageのthisはbuttonを指す
// button?.addEventListener("click", p.showMessage);
// ↓解決策
button?.addEventListener("click", p.showMessage.bind(p));

// Validation with Decorators
interface ValidatorConfig {
  [property: string]: {
    [validatableProp: string]: string[]; // something like ["required", "positive"]
  };
}

const registeredValidators: ValidatorConfig = {};

// you don't get descriptor for properties
function Required(target: any, propName: string) {
  registeredValidators[target.constructor.name] = {
    [propName]: ["required"],
  };

  console.log(registeredValidators, " Required");
}

function PositiveNumber(target: any, propName: string) {
  registeredValidators[target.constructor.name] = {
    [propName]: ["positive"],
  };

  console.log(registeredValidators, " Positive");
}

function validate(obj: any) {
  const objValidatorConfig = registeredValidators[obj.constructor.name];
  if (!objValidatorConfig) {
    return true;
  }

  for (const prop in objValidatorConfig) {
    for (const validator of objValidatorConfig[prop]) {
      switch (validator) {
        case "required":
          return !!obj[prop];
        case "positive":
          return obj[prop] > 0;
      }
    }
  }

  return true;
}

class Course {
  @Required
  title: string;
  @PositiveNumber
  price: number;

  constructor(t: string, p: number) {
    this.title = t;
    this.price = p;
  }
}

const courseForm = document.querySelector("form")!;
courseForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const titleEl = document.getElementById("title") as HTMLInputElement;
  const priceEl = document.getElementById("price") as HTMLInputElement;

  const title = titleEl.value;
  const price = +priceEl.value;

  const createdCourse = new Course(title, price);

  if (!validate(createdCourse)) {
    alert("Invalid input, please try again");
    return;
  }
  console.log(createdCourse);
});
