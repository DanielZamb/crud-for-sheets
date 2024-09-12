# Google Apps Script CRUD Class for Google Sheets

This project provides a class `DB` for managing CRUD operations (Create, Read, Update, Delete) on Google Sheets using Google Apps Script.

The class allows you to:
- Create a new Google Spreadsheet database.
- Create tables in the spreadsheet.
- Perform CRUD operations on tables.
- Sort and paginate the results.
- Apply color schemes to the sheets. 💅

## Features
- **Create, Read, Update, and Delete (CRUD)** functionality for Google Sheets.
- Supports creation of history tables for tracking deletions.
- Supports sorting and pagination for table records.
- Type validation for data entries (for now just 4 `number`, `string`, `boolean`, `date`).

## Installation

1. Open your Google Apps Script editor in Google Sheets.
2. Copy the command-sequence id of the library `1flBjZa3u09YAgozp3H-GEhkxpl61rbB2QW2SKnV7ZVlRHNhgxZydegDG` into the libraries of your project.
3. You can now use the class `CrudForSheets` for interacting with your spreadsheet.

## Example Initialization

```javascript
/**
 * Example of initializing the database and performing CRUD operations.
 */
function initDb() {
  // Initialize the database
  const db = CrudForSheets.init('myTestDatabase', dbId = "YOUR_SPREADSHEET_ID");
  // OR create a new one
  const db = CrudForSheets.init('myTestDatabase');

  // Log database creation result
  console.log(db.getCreationResult());

  // Define the structure for the employee table
  const employeeTableConfig = {
    tableName: "EMPLOYEES",
    fields: {
      name: "string",
      age: "number",
      position: "string",
      employed: "boolean",
      hire_date: "date"
    }
  };

  // Create the employee table
  db.createTable(employeeTableConfig);
  console.log("Employee table created");
}
```
## Example crud operations
```javascript
  function crudOp(){
    // Example data to insert
    const employees = [
      { name: 'John Doe', age: 30, position: 'Software Engineer', employed: true, hire_date: new Date('2022-01-15') },
      { name: 'Jane Smith', age: 28, position: 'Product Manager', employed: true, hire_date: new Date('2021-11-05') },
      // More employees...
    ];
  
    // Insert employees into the table
    employees.forEach(employee => {
      db.create('EMPLOYEES', employee, ['name', 'age', 'position', 'employed', 'hire_date']);
    });
  
    // Read an employee record by ID
    const readResult = db.read('EMPLOYEES', 1); // Assuming the employee with ID 1 exists
    console.log('Read Employee:', readResult.data);
  
    // Update an employee record
    const updatedEmployee = { name: 'John Doe', age: 31, position: 'Senior Software Engineer' };
    const updateResult = db.update('EMPLOYEES', 1, updatedEmployee, ['name', 'age', 'position']);
    console.log('Update Result:', updateResult);
  
    // Delete an employee record
    const deleteResult = db.remove('EMPLOYEES', 'DELETED_EMPLOYEES', 1);
    console.log('Delete Result:', deleteResult);
  
    // Get all employees, sorted by age in descending order, with pagination
    const getAllResult = db.getAll('EMPLOYEES', { page: 1, pageSize: 5, sortBy: 'age', sortOrder: 'desc' });
    console.log('All Employees:', getAllResult.data);
  }
```

## functions

### `init(dbName, dbId)`
- Creates or opens a spreadsheet database.
- Parameters:
  - `dbName`: The name of the database.
  - `dbId`: The ID of the Google Spreadsheet (optional). If not provided, a new spreadsheet is created.

### `createTable(config)`
- Creates a new table in the spreadsheet.
- Parameters:
  - `config`: An object with table configuration, including table name and field types.
  - example:
    ```
    {
      columnName1: "type1" ,
      columnName2: "type2" ,
      columnName3: "type3" ,
      columnName4: "type4" ,
      columnName5: "type5" ,
    }
    ```
  - valid types: `[boolean, string, Date, number]`

### `create(tableName, data, keyOrder, addUpdatePolicy = null)`
- Inserts or updates a record in the specified table.
- Parameters:
  - `tableName`: The name of the table.
  - `data`: An object containing the data to insert.
  - `keyOrder`: An array specifying the order of the fields.
  - `addUpdatePolicy`: (Optional) A policy object for updating existing records, the searchKey must be in the data received.
  - example:
    ```
    {
      key: "searchKey",
      value: "searchValue"
    }
    ```
    

### `read(tableName, id)`
- Reads a record from the table by ID.
- Parameters:
  - `tableName`: The name of the table.
  - `id`: The ID of the record to read.

### `update(tableName, id, data, keyOrder)`
- Updates an existing record by ID.
- Parameters:
  - `tableName`: The name of the table.
  - `id`: The ID of the record to update.
  - `data`: The new data to update the record with.
  - `keyOrder`: The order of the keys in the data object.
  - `addUpdatePolicy`: (Optional) A policy object for updating existing records, the searchKey must be in the data received.
  - example:
    ```
    {
      key: "searchKey",
      value: "searchValue"
    }
    ```

### `remove(tableName, historyTableName, id)`
- Deletes a record and moves it to a history table.
- Parameters:
  - `tableName`: The name of the table.
  - `historyTableName`: The name of the history table for deleted records.
  - `id`: The ID of the record to delete.

### `getAll(tableName, options = {}, useCache = true)`
- Retrieves all records from a table with optional pagination and sorting.
- Parameters:
  - `tableName`: The name of the table.
  - `options`: An object containing pagination (`page`, `pageSize`) and sorting (`sortBy`, `sortOrder`).
  - `sortBy` must be a field in the schema
  - `sortOrder` is one of [`desc`, `asc`]

## License

This project is licensed under the MIT License.
