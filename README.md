# 📊 Google Apps Script CRUD Class for Google Sheets

Welcome to the **Google Apps Script CRUD Class for Google Sheets**! This library simplifies managing your Google Sheets as databases, allowing you to perform **Create, Read, Update,** and **Delete** (CRUD) operations with ease. Whether you're building a CRM, inventory system, or any data-driven application, this library has got you covered! 🚀

![CRUD](https://img.icons8.com/color/96/000000/database.png)

## 🌟 Features

- **✨ CRUD Operations**: Seamlessly Create, Read, Update, and Delete records in Google Sheets.
- **📜 History Tracking**: Automatically track deletions with history tables.
- **🔍 Sorting & Pagination**: Easily sort and paginate your data for better management.
- **✅ Type Validation**: Ensure data integrity with type checking (`number`, `string`, `boolean`, `date`).
- **🎨 Customizable Color Schemes**: Beautify your sheets with predefined color themes.
- **⚡️ Caching**: Improve performance with built-in caching mechanisms.

## 📦 Installation

**Copy the class found in CrudForSheets.js** *( i have yet to find out how to share a library publicly, when i do follow the steps bellow)*

------------------------------------------------------------------------------------------------------------------------------------------
1. **Open Google Apps Script Editor**:
   - Go to your Google Sheets.
   - Click on `Extensions` > `Apps Script`.

2. **Add the Library**:
   - In the Apps Script editor, click on the `+` icon next to `Libraries`.
   - Enter the Library ID: `1flBjZa3u09YAgozp3H-GEhkxpl61rbB2QW2SKnV7ZVlRHNhgxZydegDG`.
   - Select the latest version and add it to your project.

3. **Use the Library**:
   - You can now use the `DB` class from the library to manage your spreadsheets.


## 📚 Usage

### 🚀 Initialization

Initialize the database by creating a new instance of the `DB` class. You can either create a new spreadsheet or connect to an existing one using its ID.

```javascript
/**
 * Initialize the database.
 */

// Declare db in your global scope in order to use it in any part of the script
const db;
const existingDb;

function initializeDatabase() {
  // Initialize a new spreadsheet database
  db = DB.init('MyDatabase');

  // OR connect to an existing spreadsheet using its ID
  existingDb = DB.init('ExistingDatabase', 'YOUR_SPREADSHEET_ID');

  // Log the creation result
  console.log(db.getCreationResult());
}
```

### 🛠️ Creating Tables

Define and create tables within your spreadsheet. Each table represents a sheet with specified fields and types.

```javascript
/**
 * Create tables in the database.
 */
let tables = []
const db = DB.init('MyDatabase');
const employeeTableConfig;
const departmentTableConfig;

function createTables() {

  // Define configuration for the EMPLOYEES table
  employeeTableConfig = {
    tableName: "EMPLOYEES",
    historyTableName: "DELETED_EMPLOYEES",
    fields: {
      name: "string",
      age: "number",
      position: "string",
      employed: "boolean",
      hire_date: "date",
    }
  };

  // Create the EMPLOYEES table
  const createResult = db.createTable(employeeTableConfig);
  console.log("Employee table created:", createResult);

  // Define configuration for the DEPARTMENTS table
   departmentTableConfig = {
    tableName: "DEPARTMENTS",
    historyTableName: "DELETED_DEPARTMENTS",
    fields: {
      department_name: "string",
      manager_id: "number",
      location: "string",
    }
  };

  // Create the DEPARTMENTS table
  const deptCreateResult = db.createTable(departmentTableConfig);
  console.log("Departments table created:", deptCreateResult);

  tables.push(employeeTableConfig);
  tables.push(departmentTableConfig);
}
```

## Important Caveats for the following Section

### 1. Serialization when calling the backend
AppScript has a bit of a problem with serialization, and as this library attempts (poorly) to manage all the fields with js primitives, when you try to retrieve something from the backend, say a Date, it will not pass anything.

#### Example
Let's say you have the following Order table

```javascript
const orderTableConfig;

function initOrderTable(){
  orderTableConfig = {
    tableName: "ORDER",
    historyTableName: "DELETED_ORDER",
    fields : {
      transaction_id: "number",
      date_valid: "date",
      date_arrived: "date",
      completed: "boolean"
    }
  }

  db.createTable(orderTableConfig)
}

initOrderTable();
console.log(db.putTableIntoDbContext(orderTableConfig));

```

if you wanted to get all the records of the table
```javascript

google.script.run
            .withFailureHandler((err)=>{
              Swal.fire("Ups!", "Something went wrong: err "+ err.message, "error")
            })
            .withSuccessHandler((response)=>{
              console.log(response)
            }).readStuffFromTable()

```

In fact, it wont return anything. It will print out `null` or `undefined` in the console. The reason being that the GoogleAppsScript Serialization Engine doesn't know how to handle `Date()` types when returning them from a function call to the `.gs` file.

#### The workaround

Just return everything over a `JSON.stringify(record)`, and the de-serialize it in the client `JSON.parse(record)`.

The function then would look like this:

```javascript
google.script.run
            .withFailureHandler((err)=>{
              Swal.fire("Ups!", "Something went wrong: err "+ err.message, "error")
            })
            .withSuccessHandler((response)=>{
              response = JSON.parse(response)
              console.log(response)
              // { code: 200, message: [all yout data parsed]}
            }).readStuffFromTable()

```

And yes this is *inefficient*, it's prone to *errors* and if don't properly catch all the exceptions that your code throws, prepare to be seing this all time classic

```javascript
Uncaught SyntaxError: Unexpected token '}', "}" is not valid JSON
    at JSON.parse (<anonymous>)
    at <anonymous>:1:6
```
But hey, who did told you to use `javascript`? if you wanted type-safety, better error management and 0 bloat in your code, you should have known better.

#### My personal recomendation
Using javascript is purely a skill issue, git gud.

### 2. The way the tables are created





## ☝️🤓 Acktually... There is 2 ways to do CRUD

if you decide to create the Tables from the library, then you can use the tableConfig objects for the CRUD operations.

like this

#### 1. With tableConfig objects
```javascript
db.create(tableConfig.tableName,
          newRecord,
          Object.keys(tableConfig.fields))
```
if you setup the sheets yourself you can also use the CRUD operations like this

#### 2. With const

```javascript
const tableName = "YOUR_TABLE_NAME";
const historyTableName = "DELETED_YOUR_TABLE_NAME";
const keyOrder = ["key1","key2", ...,"keyn"];

db.create(tableName,
          newRecord,
          keyOrder)
```

but for the love of Linus Torvalds, *PUT THEM IN THE DB CONTEXT* (or as the message would say _schema_ 🧏‍♂️)

so it would go like so 

```javascript
//call create tables to create the sheets
createTables();
//call the function that puts table into context
putTablesInSchema();

function putTablesInSchema(){
  tables.forEach( table => {
    console.log(db.putTableIntoDbContext(table))
  })
}
```
When the tables are in the DB schema, the library will recognize any CRUD operations whether you do it like (1) or (2)


### ➕ Creating Records

Insert new records into your tables. You can also define policies to update existing records based on specific conditions.

Supposing you already have initialized the DB and have some records:
```javascript
const db = DB.init('MyDatabase');

const employees = [
  {
    name: 'John Doe',
    age: 30,
    position: 'Software Engineer',
    employed: true,
    hire_date: new Date('2022-01-15')
  },
  {
    name: 'Jane Smith',
    age: 28,
    position: 'Product Manager',
    employed: true,
    hire_date: new Date('2021-11-05')
  },
];
```

1. First define a Wrapper Function
```javascript
function addEmployees(newEmployees) {
    // Method 1
   const result = db.create(employeeTableConfig.tableName,
                            newEmployees,
                            Object.keys(employeeTableConfig.fields));
   // Method 2
   const result = db.create('EMPLOYEES',
                           newEmployees,
                           ['name', 'age', 'position', 'employed', 'hire_date']);  
   console.log('Create Result:', result);
   return JSON.stringify(response)
}
```
2. Call the function when needed
```javascript
google.script.run
            .withFailureHandler((err)=>{console.log(err.message}
            .withSuccessHandler((response) => {
               response = JSON.parse(response)
               console.log(response)
            }).addEmployees(employees)   
```

### 🔍 Reading Records

Retrieve specific records or all records from a table. Supports sorting and pagination for efficient data handling.
(If you dont want to use cache, dont forget to turn it off).

```javascript
/**
 * Read all employees from the EMPLOYEES table.
 */
function readEmployees() {
  // Retrieve all employees, sorted by hire_date in descending order, 10 per page
  const employees = db.getAll('EMPLOYEES', { 
    page: 1, 
    pageSize: 10, 
    sortBy: 'hire_date', 
    sortOrder: 'desc' 
  }, false); // `false` to bypass cache

  // method 1
  const employees = db.getAll(employeeTableConfig.tableName, 
                              options={ 
                                page: 1, 
                                pageSize: 10, 
                                sortBy: 'hire_date', 
                                sortOrder: 'desc' 
                              },
                              useCache=false); // `false` to bypass cache

  console.log('Employees:', employees.data);
  return JSON.stringify(response);
}
```

### ✏️ Updating Records

Modify existing records in your tables based on their unique ID.

Supose you have and updated employee record:

```javascript
const updatedEmployee = {
  name: 'John Doe',
  age: 31, // Updated age
  position: 'Senior Software Engineer', // Updated position
  employed: true,
  hire_date: new Date('2022-01-15')
};
```
1. (Again) Define the wrapper function for the update
```javascript
/**
 * Update an employee's information.
 */
function updateEmployee(updatedEmployee) {
   //Method 1
  const updateResult = db.update(employeeTableConfig.tableName, updatedEmployee.id, updatedEmployee, Object.keys(employeeTableConfig.fields));
  console.log('Update Result:', updateResult);

   // Method 2
  const updateResult = db.update('EMPLOYEES', updatedEmployee.id, updatedEmployee, ['name', 'age', 'position', 'employed', 'hire_date']);

  return JSON.stringify(updateResult);
}
```

2. Call it when the function's needed
```javascript
google.script.run
            .withFailureHandler((err)=>{console.log(err.message}
            .withSuccessHandler((response) => {
               response = JSON.parse(response)
               console.log(response)
            }).updateEmployee(updatedEmployee)   
```

### 🗑️ Deleting Records

Remove records from your tables. Deleted records are *moved* to a history table for tracking purposes.

1. You know the drill
```javascript
/**
 * Delete an employee from the EMPLOYEES table.
 */
function deleteEmployee(id) {
  // Delete employee with ID 1 and move to DELETED_EMPLOYEES history table
  const deleteResult = db.remove('EMPLOYEES', 'DELETED_EMPLOYEES', id);

  //method 1
  const deleteResult = db.remove(employeeTableConfig.tableName, employeeTableConfig.historyTablename, id);
  console.log('Delete Result:', deleteResult);

  return JSON.stringify(deleteResult);
}
```

2. Call it when needed
```javascript
google.script.run
            .withFailureHandler((err)=>{console.log(err.message}
            .withSuccessHandler((response) => {
               response = JSON.parse(response)
               console.log(response)
            }).deleteEmployee(4)
```

### 🎨 Applying Color Schemes

Enhance the visual appeal of your sheets by applying predefined color themes.

```javascript
const db = DB.init('MyDatabase');

/**
 * Apply a color scheme to the EMPLOYEES table.
 */
function applyColorScheme() {

  // Apply the 'blue' color scheme
  db.applyColorScheme('EMPLOYEES', 'blue');
  
  console.log('Color scheme applied to EMPLOYEES table.');
}
```

## 🔧 Advanced Examples

### 📈 Fetching with Pagination and Sorting

Retrieve data with advanced options like pagination and sorting to handle large datasets efficiently.

```javascript
const db = DB.init('MyDatabase');

/**
 * Fetch paginated and sorted employee data.
 */

function fetchPaginatedEmployees() {

  const options = {
    page: 2,          // Page number
    pageSize: 5,      // Number of records per page
    sortBy: 'age',    // Field to sort by
    sortOrder: 'asc'  // Sort order: 'asc' or 'desc'
  };

  const result = db.getAll('EMPLOYEES', options, true); // `true` to use cache
  console.log(result.data);
}
```

### 🛡️ Handling Type Validation

Ensures data integrity by validating the types of incoming data before performing operations.

```javascript
const db = DB.init('MyDatabase');

/**
 * Add an employee with type validation.
 */
function addEmployeeWithValidation() {

  const employee = {
    name: 'Alice Johnson',
    age: 'Thirty', // Incorrect type: should be a number
    position: 'Designer',
    employed: true,
    hire_date: new Date('2023-03-10')
  };

  // this will err
  const result = db.create('EMPLOYEES', employee, ['name', 'age', 'position', 'employed', 'hire_date']);
  
  if (result.status === 500) {
    console.error('Failed to create employee:', result.error);
  } else {
    console.log('Employee created:', result);
  }
}
```

## 🔍 Detailed Function Documentation

### `init(dbName, dbId)`
- **Description**: Creates or opens a spreadsheet database.
- **Parameters**:
  - `dbName` *(string)*: The name of the database.
  - `dbId` *(string, optional)*: The ID of the Google Spreadsheet. If not provided, a new spreadsheet is created.
- **Returns**: An instance of the `DB` class.

### `createTable(config)`
- **Description**: Creates a new table (sheet) in the spreadsheet.
- **Parameters**:
  - `config` *(Object)*: Configuration object for the table.
    - `tableName` *(string)*: Name of the table.
    - `historyTableName` *(string, optional)*: Name of the history table for deleted records. Defaults to `DELETED_<tableName>`.
    - `fields` *(Object)*: Key-value pairs defining field names and their types.
      - **Supported Types**: `boolean`, `string`, `date`, `number`
- **Returns**: Status object with `status` and `message` or `error`.

### `create(tableName, data, keyOrder, addUpdatePolicy = null)`
- **Description**: Inserts a new record or updates an existing one based on the provided policy.
- **Parameters**:
  - `tableName` *(string)*: Name of the table.
  - `data` *(Object)*: Data to insert/update.
  - `keyOrder` *(Array<string>)*: Order of the fields.
  - `addUpdatePolicy` *(Object, optional)*: Policy for updating existing records.
    - `key` *(string)*: Field to search for existing records.
    - `value` *(any)*: Value to match for the key.
- **Returns**: Status object with `status`, `id`, and `action` or `error`.

### `read(tableName, id)`
- **Description**: Retrieves a record by its ID.
- **Parameters**:
  - `tableName` *(string)*: Name of the table.
  - `id` *(number|string)*: ID of the record.
- **Returns**: Status object with `status` and `data` or `error`.

### `update(tableName, id, data, keyOrder, typesChecked = false, addUpdatePolicy = null)`
- **Description**: Updates an existing record.
- **Parameters**:
  - `tableName` *(string)*: Name of the table.
  - `id` *(number|string)*: ID of the record.
  - `data` *(Object)*: New data for the record.
  - `keyOrder` *(Array<string>)*: Order of the fields.
  - `typesChecked` *(boolean, optional)*: Whether types have already been validated.
  - `addUpdatePolicy` *(Object, optional)*: Policy for additional updates.
- **Returns**: Status object with `status`, `id`, `data`, and `action` or `error`.

### `remove(tableName, historyTableName, id)`
- **Description**: Deletes a record and moves it to a history table.
- **Parameters**:
  - `tableName` *(string)*: Name of the table.
  - `historyTableName` *(string)*: Name of the history table.
  - `id` *(number|string)*: ID of the record.
- **Returns**: Status object with `status` and `message` or `error`.

### `getAll(tableName, options = {}, useCache = true)`
- **Description**: Retrieves all records with optional sorting and pagination.
- **Parameters**:
  - `tableName` *(string)*: Name of the table.
  - `options` *(Object, optional)*:
    - `page` *(number)*: Page number for pagination.
    - `pageSize` *(number)*: Number of records per page.
    - `sortBy` *(string)*: Field to sort by.
    - `sortOrder` *(string)*: `'asc'` or `'desc'`.
  - `useCache` *(boolean, optional)*: Whether to use cached data.
- **Returns**: Status object with `status`, `data`, and `message` or `error`.

### `applyColorScheme(tableName, colorScheme)`
- **Description**: Applies a color scheme to a table for better visualization.
- **Parameters**:
  - `tableName` *(string)*: Name of the table.
  - `colorScheme` *(string)*: Predefined color scheme (`red`, `blue`, `green`, `orange`, `purple`).
- **Returns**: Nothing. Throws an error if the color scheme is invalid.

## 📝 Example Use Case

Here's how you can integrate the `DB` class into a web application using Google Apps Script's `doGet` function.

```javascript
/**
 * Serve the web application.
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile("index")
    .evaluate()
    .setTitle("Test_crud_app")
    .setFaviconUrl("YOUR_ICON")
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Include HTML files.
 */
function include(filename){
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// Initialize the database
const db = DB.init("SHEET_NAME", "YOUR_SHEET_ID");

// Define table configurations
const requestTableConfig = {
  tableName: "PQRS",
  historyTableName: "DELETED_PQRS",
  fields: {
    client_uuid: "string",
    applicant_type: "string",
    type: "string",
    class_t: "string",
    ot_number: "number",
    facts: "string",
    document_type: "string",
    document_number: "number",
    social_reason: "string",
    name: "string",
    last_name: "string",
    email: "string",
    phone: "number",
    email_comm: "boolean",
    wpp_comm: "boolean",
    department: "string",
    city: "string",
    address: "string",
    additional: "string",
    provider: "string",
    evidence_files_ids: "string",
    efficacy: "number",
    solved: "boolean",
    responsible: 'string',
    reason: 'string' 
  }
};

const actionTableConfig = {
  tableName: "ACTION_PLAN",
  historyTableName: "DELETED_ACTION_PLAN",
  fields: {
    pqrs_fk: "number",
    plan: "string",
    date_applied: "date",
    responsible: "string",
    state: "boolean",
    observations: "string",
  }
};

// Create the table OR
console.log(db.createTable(requestTableConfig));
console.log(db.createTable(actionTableConfig));

// Add tables to the database context
console.log(db.putTableIntoDbContext(requestTableConfig));
console.log(db.putTableIntoDbContext(actionTableConfig));



// Apply a color scheme to the ACTION_PLAN table
console.log(db.applyColorScheme(actionTableConfig.tableName, 'orange'));

/**
 * Read all records from the PQRS table.
 */
function readPqrsTable(){
  const response = db.getAll("PQRS", 
                              { /* options */ },
                              false); // Disable cache for fresh data
  Logger.log(response.message);
  console.log(response.data);
  return JSON.stringify(response);
}

/**
 * Update a record in the PQRS table.
 * @param {Object} newPqrs - The updated PQRS data.
 */
function updatePQRS(updatedPqrs){
  console.log(updatedPqrs);
  const response = db.update(requestTableConfig.tableName,
                            updatedPqrs.id,
                            updatedPqrs,
                            Object.keys(requestTableConfig.fields));
  Logger.log(response);
  return JSON.stringify(response);
}

/**
 * Read all records from the ACTION_PLAN table.
 */
function readActionPlanTable(){
  const response = db.getAll(actionTableConfig.tableName, 
                              { /* options */ },
                              false); // Disable cache for fresh data
  Logger.log(response.message);
  console.log(response.data);
  return JSON.stringify(response);
}

/**
 * Create a new Action Plan.
 * @param {Object} newActionPlan - The Action Plan data to create.
 */
function createActionPlan(newActionPlan){
  const response = db.create(actionTableConfig.tableName,
                      newActionPlan,
                      Object.keys(actionTableConfig.fields));
  Logger.log(response);
  return JSON.stringify(response);
}

/**
 * Delete an Action Plan by ID.
 * @param {number} id - The ID of the Action Plan to delete.
 */
function deleteActionPlan(id){
  const response = db.remove(actionTableConfig.tableName, actionTableConfig.historyTableName, id);
  Logger.log(response);
  return JSON.stringify(response);
}

/**
 * Update an existing Action Plan.
 * @param {Object} newActionPlan - The updated Action Plan data.
 */
function updateActionPlan(updatedActionPlan){
  console.log(updatedActionPlan);
  const response = db.update(actionTableConfig.tableName,
                            updatedActionPlan.id,
                            updatedActionPlan,
                            Object.keys(actionTableConfig.fields));
  Logger.log(response);
  return JSON.stringify(response);
}
```
