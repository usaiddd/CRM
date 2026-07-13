require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');

const session = require('express-session');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
	secret: process.env.SESSION_SECRET || 'supersecret',
	resave: false,
	saveUninitialized: false,
	cookie: { secure: false }
}));

// Serve static files (the existing HTML pages)
app.use(express.static(path.join(__dirname)));

// API routes
const companiesRouter = require('./routes/companies');
const contactsRouter = require('./routes/contacts');
const tasksRouter = require('./routes/tasks');
const metadataRouter = require('./routes/metadata');
const productsRouter = require('./routes/products');
const employeesRouter = require('./routes/employees');
const clientEngagementRouter = require('./routes/client_engagement');
const salesPipelineRouter = require('./routes/sales_pipeline');
const clientProfileRouter = require('./routes/client_profile');

const agentRouter = require('./routes/agent');
const requireAgentLogin = require('./routes/requireAgentLogin');

app.use('/api/companies', companiesRouter);
app.use('/api/contacts', contactsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/metadata', metadataRouter);
app.use('/api/products', productsRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/client_engagement', clientEngagementRouter);
app.use('/api/sales_pipeline', salesPipelineRouter);
app.use('/api/client_profile', clientProfileRouter);

app.use('/api/agent-login', agentRouter);

// Simple health check
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Protect agent portal pages
const agentPages = [
	'agent.html',
	'company_records.html',
	'contact_person_records.html',
	'add_contact_person.html',
	'tasks.html',
	'products.html',
	'contact_records.html'
];
agentPages.forEach(page => {
	app.get(`/templates/${page}`, requireAgentLogin, (req, res) => {
		res.sendFile(path.join(__dirname, 'templates', page));
	});
});

app.listen(port, () => console.log(`Server listening on port ${port}`));
