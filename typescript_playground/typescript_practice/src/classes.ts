abstract class Department {
  // private readonly id: string;
  // private name: string;
  protected employees: string[] = [];

  static fiscalYear = 2020;

  constructor(
    protected readonly id: string,
    public name: string,
  ) {
    console.log(this);
    console.log(Department);
    // this.id = id;
    // this.name = n;
  }

  abstract describe(this: Department): void;

  addEmployee(employee: string) {
    // validation etc
    // this.id = 'd2';
    this.employees.push(employee);
  }

  printEmployeeInformation() {
    // console.log(this.employees.length);
    // console.log(this.employees);
  }

  static createEmployee(name: string) {
    return { name };
  }
}

class ITDepartment extends Department {
  admins: string[];
  constructor(id: string, admins: string[]) {
    super(id, "IT");
    this.admins = admins;
  }

  describe() {
    // console.log(`IT Department - ID: ${this.id}`);
  }
}

class AccountingDepartment extends Department {
  private lastReport: string;
  private static instance: AccountingDepartment;

  get mostRecentReport() {
    if (this.lastReport) {
      return this.lastReport;
    }
    throw new Error("No report found.");
  }

  set mostRecentReport(value: string) {
    if (!value) {
      throw new Error("Please pass in a valid value!");
    }
    this.addReport(value);
  }

  private constructor(
    id: string,
    private reports: string[],
  ) {
    super(id, "Accounting");
    this.lastReport = reports[0];
  }

  static getInstance() {
    // this = AccountingDepartment. staticメソッドの時はthisはクラス名を指す
    if (this.instance) {
      return this.instance;
    }
    this.instance = new AccountingDepartment("d2", []);
    return this.instance;
  }

  addEmployee(name: string) {
    if (name === "Max") {
      return;
    }
    this.employees.push(name);
  }

  addReport(text: string) {
    this.reports.push(text);
    this.lastReport = text;
  }

  printReports() {
    // console.log(this.reports);
  }

  describe() {
    // console.log("Accounting Department - ID: " + this.id);
  }
}

const employee1 = Department.createEmployee("Max");
// console.log(employee1.name + "はstaticですよねええええええええええええ");
// console.log(Department.fiscalYear + "年です");

const it = new ITDepartment("d1", ["Max"]);

it.addEmployee("Max");
it.addEmployee("Manu");

// it.employees[2] = 'Anna';

it.describe();
it.name = "NEW NAME";
it.printEmployeeInformation();

// console.log(it);

const accounting = AccountingDepartment.getInstance();

accounting.mostRecentReport = "Year End Report";
accounting.addReport("Something went wrong...");
// console.log(accounting.mostRecentReport);

accounting.addEmployee("Max");
accounting.addEmployee("Manu");

accounting.printReports();
accounting.printEmployeeInformation();

// const accountingCopy = { name: 'DUMMY', describe: accounting.describe };

// accountingCopy.describe();
