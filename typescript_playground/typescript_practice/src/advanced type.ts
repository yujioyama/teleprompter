interface Admin {
  name: string;
  privileges: string[];
}

interface Employee {
  name: string;
  startDate: Date;
}

interface ElevatedEmployee extends Admin, Employee {}

// type ElevatedEmployee = Admin & Employee;

const el: ElevatedEmployee = {
  name: "Max",
  privileges: ["create-server"],
  startDate: new Date(),
};

type Combinable = string | number;
type Numeric = number | boolean;
type Universal = Combinable & Numeric;

function add(a: number, b: number): number;
function add(a: string, b: string): string;
function add(a: string, b: number): string;
function add(a: number, b: string): string;
function add(a: Combinable, b: Combinable) {
  if (typeof a === "string" || typeof b === "string") {
    return a.toString() + b.toString;
  }

  return a + b;
}

const result = add("Max", " Schwarz");
result.split(" ");

const fetchedUserData = {
  id: "u1",
  name: "Max",
  job: {
    title: "CEO",
    description: "My own company",
  },
};

// javascriptにおける、fetchedUserData.jobが存在するかを確認する方法
console.log(fetchedUserData.job && fetchedUserData.job.title);

// typescriptバージョン
console.log(fetchedUserData?.job?.title);

// 【Nullish Coalescing】
//  このままだとuserInputがfalsyな値なので、コンソールログ後、
//  DEFAULTが出力される。"""はOKとして、userInputを出力したいかも。
//  undefinedやnullの時だけDEFAULTを出したい！
const userInput = "";

// const storedData = userInput || "DEFAULT";

// ここで nullish operatorを使用。""が出力されます！
const storedData = userInput ?? "DEFAULT";

console.log(storedData);

type UnknownEmployee = Employee | Admin;

function printEmployeeInformation(employee: UnknownEmployee) {
  console.log("Name: " + employee.name);
  if ("privileges" in employee) {
    console.log("Privileges: " + employee.privileges);
  }
  if ("startDate" in employee) {
    console.log("Start Date: " + employee.startDate);
  }
}

printEmployeeInformation(el);

class Car {
  drive() {
    console.log("Driving...");
  }
}

class Truck {
  drive() {
    console.log("Driving a truck...");
  }

  loadCargo(amount: number) {
    console.log("Loading cargo ..." + amount);
  }
}

type Vehicle = Car | Truck;
const v1 = new Car();
const v2 = new Truck();

function useVehicle(vehicle: Vehicle) {
  vehicle.drive();
  // if ("loadCargo" in vehicle) {
  //   vehicle.loadCargo(1000)
  // }

  if (vehicle instanceof Truck) {
    vehicle.loadCargo(1000);
  }
}

useVehicle(v1);
useVehicle(v2);

interface Bird {
  type: "bird";
  flyingSpeed: number;
}

interface Horse {
  type: "horse";
  runningSpeed: number;
}

type Animal = Bird | Horse;

function moveAnimal(animal: Animal) {
  let speed;

  switch (animal.type) {
    case "bird":
      speed = animal.flyingSpeed;
      break;
    case "horse":
      speed = animal.runningSpeed;
  }

  console.log("Moving at speed: " + speed);
}

moveAnimal({ type: "bird", flyingSpeed: 10 });

// const paragraph = document.querySelector("p");

// const userInputElement = <HTMLInputElement>(
//   document.getElementById("user-input")
// );

const userInputElement = document.getElementById(
  "user-input",
)! as HTMLInputElement;

userInputElement.value = "Hi there";

interface ErrorContainer {
  // {email: "Not a valid email address", username: "Must start with a letter"}
  [prop: string]: string;
}

const errorBag: ErrorContainer = {
  // 1: "what", これは大丈夫。数字はstringになれる
  email: "Not a valid email address",
  username: "Must start with a capital letter",
};
