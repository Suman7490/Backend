import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv'
import express from 'express';
import mysql from 'mysql2';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';

// Define __dirname manually
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


dotenv.config();
const app = express();
app.use(cors({
    origin: ['http://localhost:3000/', 'https://quotation.kalpresearchwork.com'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 10,
    connectTimeout: 10000,
})

db.getConnection(err => {
    if (err) {
        console.error('Error connecting to MySQL: ', err);
        return;
    }
    console.log('Connected to MySQL Database');
});
// *****************************************************************
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'https://quotation.kalpresearchwork.com');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

// ************** For getting all the routes ***********************
app.use(express.static(path.join(__dirname, 'public_html')));

app.post('/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).send('Email and password are required.');
    }

    const query = 'SELECT * FROM admin WHERE email = ? AND password = ?';
    db.query(query, [email, password], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Internal server error.');
        }

        if (results.length > 0) {
            // res.cookie('auth', email, { httpOnly: true });
            res.status(200).json({ LoginStatus: true, message: 'Login successful.' });
        } else {
            res.status(401).json({ LoginStatus: false, Error: 'Invalid email or password.' });
        }
    });
});




// ************* Get Data *************
app.get('/', (req, res) => {
    const sql = `
      SELECT q.quotation_id, q.name, q.email, q.gender, q.domain, q.date,  q.total, q.totalDiscount, q.finalAmount, q.totalService, q.inputCount,
             p.label, p.dueWhen, p.installmentAmount,
             s.serviceName, s.price, s.discount, s.grandTotal
      FROM quotation q
      INNER JOIN services s ON q.quotation_id = s.quotation_id
      INNER JOIN payments p ON q.quotation_id = p.quotation_id;
  `;


    db.query(sql, (err, result) => {
        if (err) return res.json({ Message: "Error inside server" });

        const data = {}
        result.forEach(row => {
            // If the quotation_id is not already in the data object, create it
            if (!data[row.quotation_id]) {
                data[row.quotation_id] = {
                    id: row.quotation_id,
                    name: row.name,
                    email: row.email,
                    gender: row.gender,
                    date: row.date,
                    domain: row.domain,
                    total: row.total,
                    totalDiscount: row.totalDiscount,
                    finalAmount: row.finalAmount,
                    totalService: row.totalService,
                    inputCount: row.inputCount,
                    services: [],
                    installments: [],
                    totalServices: 0,
                    totalInstallment: 0
                };
            }

            // Add the services data to the services array
            if (row.serviceName && !data[row.quotation_id].services.some(s => s.serviceName === row.serviceName && s.price === row.price)) {
                data[row.quotation_id].services.push({
                    serviceName: row.serviceName,
                    price: row.price,
                    discount: row.discount,
                    grandTotal: row.grandTotal
                });
                data[row.quotation_id].totalServices++;
            }

            // Add the installment data to the installments array
            if (row.label && !data[row.quotation_id].installments.some(i => i.label === row.label && i.installmentAmount === row.installmentAmount)) {
                data[row.quotation_id].installments.push({
                    label: row.label,
                    dueWhen: row.dueWhen,
                    installmentAmount: row.installmentAmount
                });
                data[row.quotation_id].totalInstallment++;
            }
        });

        // Convert the object into an array if necessary
        const response = Object.values(data);
        return res.json(response);
    });
});

// ************* Post Data ************
app.post('/create', (req, res) => {
    const quotation_sql = "INSERT INTO quotation (`name`, `email`, `gender`, `date`, `domain`, `total`, `totalDiscount`, `finalAmount`, `totalService`, `inputCount`) VALUES (?)";
    const quotation_values = [
        req.body.name,
        req.body.email,
        req.body.gender,
        req.body.date,
        req.body.domain,
        req.body.total,
        req.body.totalDiscount,
        req.body.finalAmount,
        req.body.totalService,
        req.body.inputCount
    ];
    console.log("Received data:", quotation_values);
    db.query(quotation_sql, [quotation_values], (err, result) => {
        if (err) return res.json(err);

        const quotationId = result.insertId;
        const installments = req.body.installments.map(installment => [
            quotationId,
            installment.label,
            installment.dueWhen,
            installment.installmentAmount
        ]);

        const services = req.body.services.map(service => [
            quotationId,
            service.service,
            service.price,
            service.discount,
            service.grandTotal
        ]);

        const installmentsSql = `INSERT INTO payments 
      (\`quotation_id\`, \`label\`, \`dueWhen\`, \`installmentAmount\`) 
      VALUES ?`;

        const servicesSql = `INSERT INTO services 
      (\`quotation_id\`, \`serviceName\`, \`price\`, \`discount\`, \`grandTotal\`) 
      VALUES ?`;

        db.query(servicesSql, [services], (err, servicesResult) => {
            if (err) return res.json(err);

            // Insert into the services table
            db.query(installmentsSql, [installments], (err, installmentsResult) => {
                if (err) return res.json(err);

                return res.json({
                    message: 'Quotation, Installments, and Services added successfully!',
                    quotationId: quotationId,
                    servicesResult,
                    installmentsResult
                });
            });
        });
    });
});

// ********************* Edit Data ****************
app.put('/update/:id', (req, res) => {
    const quotationId = req.params.id;

    // Update quotation data
    const quotationSql = `
      UPDATE quotation 
      SET name = ?, email = ?, gender = ?, date = ?, domain = ?, total = ?, totalDiscount = ?, finalAmount = ?, totalService = ?, inputCount = ? 
      WHERE quotation_id = ?`;

    const quotationValues = [
        req.body.name,
        req.body.email,
        req.body.gender,
        req.body.date,
        req.body.domain,
        req.body.total,
        req.body.totalDiscount,
        req.body.finalAmount,
        req.body.totalService,
        req.body.inputCount,
        quotationId
    ];

    // Run the update query for the quotation
    console.log("QuotationSql, quotationValues: ", quotationSql, quotationValues)
    db.query(quotationSql, quotationValues, (err, result) => {
        if (err) {
            console.error('Error executing quotation update:', err);  // Log error
            return res.status(500).json({ error: 'Quotation update failed' });
        }
        let serviceUpdateResult, installmentUpdateResult;
        // **Handling services**
        const services = req.body.services.map(service => [
            quotationId,
            service.id || null,
            service.service || "",
            service.price || 0,
            service.discount || 0,
            service.grandTotal || 0
        ]);
        console.log("Services data received:", services);

        // Step 1: Delete any extra services that are no longer needed
        let servicesToKeep = services
            .map(service => service[1])
            .filter(id => id != null); // Keep only the services with IDs

        console.log("Services to keep (by ID):", servicesToKeep);

        // Conditionally delete services depending on whether there are any to keep
        let deleteServicesQuery;
        if (servicesToKeep.length > 0) {
            deleteServicesQuery = `DELETE FROM services WHERE quotation_id = ? AND id NOT IN (?)`;
            console.log("Executing services delete query:", deleteServicesQuery, [quotationId, servicesToKeep]);
            db.query(deleteServicesQuery, [quotationId, servicesToKeep], (err, deleteServiceResult) => {
                if (err) return res.json(err);

                // Step 2: Insert or Update the remaining services
                insertOrUpdateServices();
            });
        } else {
            // If there are no services to keep, delete all services for this quotation
            deleteServicesQuery = `DELETE FROM services WHERE quotation_id = ?`;
            console.log("Executing services delete query:", deleteServicesQuery, [quotationId]);
            db.query(deleteServicesQuery, [quotationId], (err, deleteServiceResult) => {
                if (err) return res.json(err);

                // Step 2: Insert or Update the remaining services
                insertOrUpdateServices();
            });
        }

        // Function to insert or update services after deletion
        const insertOrUpdateServices = () => {
            const servicesSql = `
              INSERT INTO services (quotation_id, id, serviceName, price, discount, grandTotal)
              VALUES ? 
              ON DUPLICATE KEY UPDATE
              serviceName = VALUES(serviceName), price = VALUES(price), discount = VALUES(discount), grandTotal = VALUES(grandTotal)`;
            console.log("servicesSql: ", servicesSql, [services.map(service => service)])
            db.query(servicesSql, [services.map(service => service)], (err, result) => {
                if (err) return res.json(err);
                serviceUpdateResult = result;
                // **Handling installments**
                handleInstallments();
            });
        }

        // **Handling installments**
        const handleInstallments = () => {
            const installments = req.body.installments.map(installment => [
                quotationId,
                installment.id || null,       // Assuming installment.id is passed from frontend for existing installments
                installment.label || "",
                installment.dueWhen || "",
                installment.installmentAmount || 0
            ]);
            console.log("Installments data received:", installments);

            let installmentsToKeep = installments
                .map(installment => installment[1])
                .filter(id => id != null);

            console.log("Installments to keep (by ID):", installmentsToKeep);

            // Step 3: Conditionally delete installments
            let deleteInstallmentsQuery;
            if (installmentsToKeep.length > 0) {
                deleteInstallmentsQuery = `DELETE FROM payments WHERE quotation_id = ? AND id NOT IN (?)`;
                console.log("deleteInstallmentsQuery: ", deleteInstallmentsQuery, [quotationId, installmentsToKeep]);
                db.query(deleteInstallmentsQuery, [quotationId, installmentsToKeep], (err, deleteInstallmentResult) => {
                    if (err) return res.json(err);
                    insertOrUpdateInstallments();
                });
            } else {
                // If there are no installments to keep, delete all installments for this quotation
                deleteInstallmentsQuery = `DELETE FROM payments WHERE quotation_id = ?`;
                console.log("deleteInstallmentsQuery (deleting all installments): ", deleteInstallmentsQuery, [quotationId]);
                db.query(deleteInstallmentsQuery, [quotationId], (err, deleteInstallmentResult) => {
                    if (err) return res.json(err);
                    insertOrUpdateInstallments();
                });
            }
        }

        // Function to insert or update installments after deletion
        const insertOrUpdateInstallments = () => {
            const installments = req.body.installments.map(installment => [
                quotationId,
                installment.id || null,       // Assuming installment.id is passed from frontend for existing installments
                installment.label || "",
                installment.dueWhen || "",
                installment.installmentAmount || 0
            ]);
            const installmentsSql = `
              INSERT INTO payments (quotation_id, id, label, dueWhen, installmentAmount)
              VALUES ? 
              ON DUPLICATE KEY UPDATE
              label = VALUES(label), dueWhen = VALUES(dueWhen), installmentAmount = VALUES(installmentAmount)`;
            console.log("installmentsSql: ", installmentsSql, [installments.map(installment => installment)]);
            db.query(installmentsSql, [installments.map(installment => installment)], (err, result) => {
                if (err) return res.json(err);
                installmentUpdateResult = result;
                // Final response after successful update
                return res.json({
                    message: 'Quotation, Installments, and Services updated successfully!',
                    quotationId: quotationId,
                    serviceUpdateResult,
                    installmentUpdateResult
                });
            });
        }
    });
});

// ************** Delete data ***************
app.delete('/delete/:id', (req, res) => {
    const quotationId = req.params.id;

    // SQL query to delete the quotation
    const deleteQuotationSql = `DELETE FROM quotation WHERE quotation_id = ?`;

    db.query(deleteQuotationSql, [quotationId], (err, result) => {
        if (err) {
            console.error('Error deleting quotation:', err);
            return res.status(500).json({ message: 'Error deleting quotation', error: err });
        }

        // Check if any rows were affected (i.e., if the delete was successful)
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Quotation not found' });
        }

        // Delete associated installments
        const deleteInstallmentsSql = `DELETE FROM payments WHERE quotation_id = ?`;
        const deleteServicesSql = `DELETE FROM services WHERE quotation_id = ?`;
        db.query(deleteInstallmentsSql, [quotationId], (err, result) => {
            if (err) {
                console.error('Error deleting installments:', err);
                return res.status(500).json({ message: 'Error deleting installments', error: err });
            }

            db.query(deleteServicesSql, [quotationId], (err, result) => {
                if (err) {
                    console.error('Error deleting services:', err);
                    return res.status(500).json({ message: 'Error deleting services', error: err });
                }

                return res.json({ message: "Quotation, installments, and services deleted successfully" });
            });
        });
    });
});

// ************* Get Data by Quotation ID *************
app.get('/pdf/:id', (req, res) => {
    const quotationId = req.params.id;
    const sql = `
       SELECT q.quotation_id, q.name, q.email, q.gender, q.domain, q.date,  q.total, q.totalDiscount, q.finalAmount, q.totalService, q.inputCount,
             p.label, p.dueWhen, p.installmentAmount,
             s.serviceName, s.price, s.discount, s.grandTotal
      FROM quotation q
      LEFT JOIN payments p ON q.quotation_id = p.quotation_id
      LEFT JOIN services s ON q.quotation_id = s.quotation_id
      WHERE q.quotation_id = ?
  `;

    db.query(sql, [quotationId], (err, result) => {
        if (err) return res.json({ Message: "Error retrieving data" });

        if (result.length === 0) {
            return res.json({ Message: "Quotation not found" });
        }

        const data = {
            id: result[0].quotation_id,
            name: result[0].name,
            email: result[0].email,
            gender: result[0].gender,
            date: result[0].date,
            domain: result[0].domain,
            total: result[0].total,
            totalDiscount: result[0].totalDiscount,
            finalAmount: result[0].finalAmount,
            inputCount: result[0].inputCount,
            services: [],
            installments: [],
            totalServices: 0,
            totalInstallment: 0
        };

        const addedInstallments = new Set();

        result.forEach(row => {
            if (row.serviceName && !addedInstallments.has(row.serviceName)) {
                data.services.push({
                    service: row.serviceName,
                    price: row.price,
                    discount: row.discount,
                    grandTotal: row.grandTotal
                });
                addedInstallments.add(row.serviceName);
                data.totalServices++;
            }
            if (row.label && !addedInstallments.has(row.label)) {
                data.installments.push({
                    label: row.label,
                    dueWhen: row.dueWhen,
                    installmentAmount: row.installmentAmount
                });
                addedInstallments.add(row.label);
                data.totalInstallment++;
            }
        });

        return res.json(data);
    });
});


// Catch-all handler for other requests
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public_html', 'index.html'));
});


// *********************************************************************
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log("Listening")
    console.log(`${process.env.PORT}, ${process.env.DB_HOST}, ${process.env.DB_NAME}, ${process.env.DB_USER}, ${process.env.DB_PASSWORD}`)
})