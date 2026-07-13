-- Industry
CREATE TABLE industry (
    industry_id SERIAL PRIMARY KEY,
    industry_name TEXT NOT NULL UNIQUE
);

-- Category
CREATE TABLE category (
    category_id SERIAL PRIMARY KEY,
    category_name TEXT NOT NULL UNIQUE
);

-- Department
CREATE TABLE department (
    department_id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

-- Designation
CREATE TABLE designation (
    designation_id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

-- Sales Stages
CREATE TABLE sales_stage (
    sales_stage_id SERIAL PRIMARY KEY,
    stage_name TEXT NOT NULL,
    sequence INT NOT NULL
);

--done
CREATE TABLE company (
    company_id SERIAL PRIMARY KEY,
    legal_name TEXT NOT NULL,
    brand TEXT,
    scale TEXT,
    industry_id INT REFERENCES industry(industry_id),
    category_id INT REFERENCES category(category_id),
    website TEXT,
    linkedin_url TEXT,
    company_type TEXT CHECK (company_type IN ('internal','client','partner','lead')),
    status TEXT DEFAULT 'setting up context',
    created_at TIMESTAMP DEFAULT NOW()
);

--done
CREATE TABLE address (
    address_id SERIAL PRIMARY KEY,
    address_line1 TEXT,
    address_line2 TEXT,
    city TEXT,
    state TEXT,
    country TEXT,
    pincode TEXT
);

--done
CREATE TABLE company_address (
    company_id INT REFERENCES company(company_id),
    address_id INT REFERENCES address(address_id),
    address_type TEXT,
    PRIMARY KEY (company_id, address_id)
);

--done
CREATE TABLE company_contact (
    company_id INT PRIMARY KEY REFERENCES company(company_id),
    isd_code TEXT,
    area_code TEXT,
    phone_primary TEXT,
    phone_secondary TEXT,
    fax TEXT,
    email_primary TEXT,
    email_secondary TEXT
);

CREATE TABLE employee (
    employee_id SERIAL PRIMARY KEY,
    company_id INT REFERENCES company(company_id),
    first_name TEXT,
    middle_name TEXT,
    last_name TEXT,
    aadhaar_number TEXT UNIQUE,
    date_of_birth DATE,
    blood_group TEXT,
    date_of_joining DATE,
    date_of_resigning DATE,
    last_working_date DATE,
    department_id INT   (department_id),
    designation_id INT REFERENCES designation(designation_id),
    status TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE employee_contact (
    employee_id INT PRIMARY KEY REFERENCES employee(employee_id),
    mobile_primary TEXT,
    mobile_secondary TEXT,
    email_primary TEXT,
    email_secondary TEXT,
    home_phone TEXT,
    current_address TEXT,
    permanent_address TEXT
);

--done
CREATE TABLE contact (
    contact_id SERIAL PRIMARY KEY,
    company_id INT REFERENCES company(company_id),
    salutation TEXT,
    first_name TEXT,
    middle_name TEXT,
    last_name TEXT,
    designation TEXT,
    department TEXT,
    linkedin_url TEXT,
    notes TEXT,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

--done
CREATE TABLE contact_contact (
    contact_id INT PRIMARY KEY REFERENCES contact(contact_id),
    mobile_primary TEXT,
    mobile_secondary TEXT,
    direct_number TEXT,
    extension TEXT,
    email_primary TEXT,
    email_secondary TEXT
);

CREATE TABLE task_status (
    status_id SERIAL PRIMARY KEY,
    status_name TEXT UNIQUE
);

CREATE TABLE task (
    task_id SERIAL PRIMARY KEY,
    company_id INT REFERENCES company(company_id),
    contact_id INT REFERENCES contact(contact_id),
    created_by INT REFERENCES employee(employee_id),
    assigned_to INT REFERENCES employee(employee_id),
    created_at TIMESTAMP DEFAULT NOW(),
    due_date DATE,
    estimated_completion DATE,
    actual_completion DATE,
    action_date DATE,
    action_taken TEXT,
    status_id INT REFERENCES task_status(status_id),
    description TEXT
);

CREATE TABLE task_assignment (
    task_id INT REFERENCES task(task_id),
    employee_id INT REFERENCES employee(employee_id),
    role TEXT,
    PRIMARY KEY (task_id, employee_id)
);

CREATE TABLE communication (
    communication_id SERIAL PRIMARY KEY,
    entity_type TEXT,
    entity_id INT,
    communication_date TIMESTAMP,
    source TEXT,
    summary TEXT,
    created_by INT REFERENCES employee(employee_id)
);

--done
CREATE TABLE hsn (
    hsn_id SERIAL PRIMARY KEY,
    hsn_code TEXT UNIQUE NOT NULL,
    description TEXT,
    active BOOLEAN DEFAULT TRUE
);

--done
CREATE TABLE product (
    product_id SERIAL PRIMARY KEY,
    product_name TEXT NOT NULL,
    hsn_id INT REFERENCES hsn(hsn_id),
    active BOOLEAN DEFAULT TRUE
);

--done(maybe)
CREATE TABLE product_industry (
    product_id INT REFERENCES product(product_id),
    industry_id INT REFERENCES industry(industry_id),
    PRIMARY KEY (product_id, industry_id)
);


CREATE TABLE client_profile (
    company_id INT PRIMARY KEY REFERENCES company(company_id),
    onboard_date DATE,
    primary_market TEXT,
    export_readiness_level TEXT,
    notes TEXT
);

CREATE TABLE client_engagement (
    engagement_id SERIAL PRIMARY KEY,
    client_company_id INT REFERENCES company(company_id),
    internal_company_id INT REFERENCES company(company_id),
    lead_owner_id INT REFERENCES employee(employee_id),
    engagement_status TEXT,
    sales_stage_id INT REFERENCES sales_stage(sales_stage_id),
    onboard_date DATE, 
    source_type text,
    source_name text,
    created_at TIMESTAMP DEFAULT NOW(),
    remarks TEXT
);

CREATE TABLE engagement_product (
    engagement_id INT REFERENCES client_engagement(engagement_id),
    product_id INT REFERENCES product(product_id),
    hsn_id INT REFERENCES hsn(hsn_id),
    PRIMARY KEY (engagement_id, product_id)
);

CREATE TABLE engagement_contact (
    engagement_id INT REFERENCES client_engagement(engagement_id),
    contact_id INT REFERENCES contact(contact_id),
    role TEXT,
    PRIMARY KEY (engagement_id, contact_id)
);

CREATE TABLE engagement_team (
    engagement_id INT REFERENCES client_engagement(engagement_id),
    employee_id INT REFERENCES employee(employee_id),
    role TEXT,
    PRIMARY KEY (engagement_id, employee_id)
);

CREATE TABLE sales_pipeline (
    pipeline_id SERIAL PRIMARY KEY,
    engagement_id INT REFERENCES client_engagement(engagement_id),
    sales_stage_id INT REFERENCES sales_stage(sales_stage_id),
    demo_booking_date DATE,
    demo_scheduled_date DATE,
    status TEXT,
    updated_at TIMESTAMP DEFAULT NOW(),
    demo_held_date DATE
);

CREATE TABLE attachment (
    attachment_id SERIAL PRIMARY KEY,
    entity_type TEXT,
    entity_id INT,
    file_name TEXT,
    file_type TEXT,
    storage_reference TEXT,
    uploaded_by INT REFERENCES employee(employee_id),
    uploaded_at TIMESTAMP DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION validate_polymorphic_reference()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.entity_type = 'company' THEN
        IF NOT EXISTS (SELECT 1 FROM company WHERE company_id = NEW.entity_id) THEN
            RAISE EXCEPTION 'Invalid company_id %', NEW.entity_id;
        END IF;

    ELSIF NEW.entity_type = 'contact' THEN
        IF NOT EXISTS (SELECT 1 FROM contact WHERE contact_id = NEW.entity_id) THEN
            RAISE EXCEPTION 'Invalid contact_id %', NEW.entity_id;
        END IF;

    ELSIF NEW.entity_type = 'engagement' THEN
        IF NOT EXISTS (SELECT 1 FROM client_engagement WHERE engagement_id = NEW.entity_id) THEN
            RAISE EXCEPTION 'Invalid engagement_id %', NEW.entity_id;
        END IF;

    ELSE
        RAISE EXCEPTION 'Invalid entity_type %', NEW.entity_type;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_communication_entity
BEFORE INSERT OR UPDATE ON communication
FOR EACH ROW
EXECUTE FUNCTION validate_polymorphic_reference();

CREATE TRIGGER trg_validate_attachment_entity
BEFORE INSERT OR UPDATE ON attachment
FOR EACH ROW
EXECUTE FUNCTION validate_polymorphic_reference();

CREATE OR REPLACE FUNCTION sync_engagement_status()
RETURNS TRIGGER AS $$
DECLARE
    final_stage INT;
BEGIN
    SELECT sales_stage_id
    INTO final_stage
    FROM sales_stage
    ORDER BY sequence DESC
    LIMIT 1;

    IF NEW.sales_stage_id = final_stage THEN
        UPDATE client_engagement
        SET engagement_status = 'active'
        WHERE engagement_id = NEW.engagement_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_engagement_status
AFTER INSERT OR UPDATE ON sales_pipeline
FOR EACH ROW
EXECUTE FUNCTION sync_engagement_status();

CREATE OR REPLACE FUNCTION sync_company_type_on_engagement()
RETURNS TRIGGER AS $$
DECLARE
    final_stage INT;
    current_type TEXT;
    target_type TEXT;
BEGIN
    SELECT sales_stage_id INTO final_stage
    FROM sales_stage
    ORDER BY sequence DESC
    LIMIT 1;

    IF NEW.sales_stage_id IS NOT NULL AND NEW.sales_stage_id = final_stage THEN
        target_type := 'client';
    ELSE
        target_type := 'lead';
    END IF;

    SELECT company_type INTO current_type
    FROM company
    WHERE company_id = NEW.client_company_id;

    IF current_type IS NULL OR current_type = 'client' OR current_type = 'lead' THEN
        IF current_type IS DISTINCT FROM target_type THEN
            UPDATE company
            SET company_type = target_type
            WHERE company_id = NEW.client_company_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_company_type_on_engagement
AFTER INSERT OR UPDATE OF sales_stage_id ON client_engagement
FOR EACH ROW
EXECUTE FUNCTION sync_company_type_on_engagement();

CREATE OR REPLACE FUNCTION enforce_single_active_pipeline()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM sales_pipeline
        WHERE engagement_id = NEW.engagement_id
          AND status = 'active'
          AND pipeline_id <> COALESCE(NEW.pipeline_id, -1)
    ) THEN
        RAISE EXCEPTION 'Only one active pipeline allowed per engagement';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_single_active_pipeline
BEFORE INSERT OR UPDATE ON sales_pipeline
FOR EACH ROW
EXECUTE FUNCTION enforce_single_active_pipeline();

CREATE OR REPLACE FUNCTION prevent_inactive_employee_assignment()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM employee
        WHERE employee_id = NEW.employee_id
          AND status <> 'active'
    ) THEN
        RAISE EXCEPTION 'Inactive employee cannot be assigned';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_inactive_assignment
BEFORE INSERT ON engagement_team
FOR EACH ROW
EXECUTE FUNCTION prevent_inactive_employee_assignment();

CREATE TABLE audit_log (
    audit_id BIGSERIAL PRIMARY KEY,
    table_name TEXT,
    record_id INT,
    action TEXT,
    changed_by INT,
    old_data JSONB,
    new_data JSONB,
    changed_at TIMESTAMP DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION audit_trigger()
RETURNS TRIGGER AS $$
DECLARE
    pk_col TEXT;
    rec_id TEXT;
    newb JSONB;
    oldb JSONB;
BEGIN
    -- Attempt to discover the table's primary key column name
    SELECT a.attname INTO pk_col
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = TG_TABLE_NAME::regclass AND i.indisprimary
    LIMIT 1;

    -- Fallback: common PK names
    IF pk_col IS NULL THEN
        IF (TG_TABLE_NAME || '') LIKE '%engagement%' THEN
            pk_col := 'engagement_id';
        ELSE
            pk_col := 'id';
        END IF;
    END IF;

    IF TG_OP = 'INSERT' THEN
        newb := to_jsonb(NEW);
        rec_id := newb ->> pk_col;
        INSERT INTO audit_log (table_name, record_id, action, new_data, changed_at)
        VALUES (TG_TABLE_NAME, CASE WHEN rec_id ~ '^\d+$' THEN rec_id::int ELSE NULL END, 'INSERT', newb, NOW());
        RETURN NEW;

    ELSIF TG_OP = 'UPDATE' THEN
        newb := to_jsonb(NEW);
        oldb := to_jsonb(OLD);
        rec_id := newb ->> pk_col;
        INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_at)
        VALUES (TG_TABLE_NAME, CASE WHEN rec_id ~ '^\d+$' THEN rec_id::int ELSE NULL END, 'UPDATE', oldb, newb, NOW());
        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        oldb := to_jsonb(OLD);
        rec_id := oldb ->> pk_col;
        INSERT INTO audit_log (table_name, record_id, action, old_data, changed_at)
        VALUES (TG_TABLE_NAME, CASE WHEN rec_id ~ '^\d+$' THEN rec_id::int ELSE NULL END, 'DELETE', oldb, NOW());
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_client_engagement
AFTER INSERT OR UPDATE OR DELETE ON client_engagement
FOR EACH ROW
EXECUTE FUNCTION audit_trigger();

CREATE OR REPLACE FUNCTION normalize_email()
RETURNS TRIGGER AS $$
BEGIN
    NEW.email_primary := LOWER(NEW.email_primary);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_normalize_company_email
BEFORE INSERT OR UPDATE ON company_contact
FOR EACH ROW
EXECUTE FUNCTION normalize_email();

CREATE TABLE emp_login (
    user_login VARCHAR(100) PRIMARY KEY,
    password TEXT NOT NULL,
    id_admin BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE OR REPLACE FUNCTION hash_password()
RETURNS TRIGGER AS $$
BEGIN
    NEW.password := crypt(NEW.password, gen_salt('bf'));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER encrypt_password_trigger
BEFORE INSERT ON emp_login
FOR EACH ROW
EXECUTE FUNCTION hash_password();

CREATE TABLE emplog(
    user_login varchar(100) REFERENCES emp_login(user_login),
    emp_id int REFERENCES employee(employee_id),
);

CREATE TABLE contact_details(
    contact_id int PRIMARY KEY REFERENCES contact(contact_id),
    first_contact DATE,
    last_contact DATE,
    f_contact_mode varchar(100),
    l_contact_mode varchar(100)
);

CREATE TABLE contact_records(
    record_number SERIAL PRIMARY KEY,
    contact_id int REFERENCES contact(contact_id),
    contact_source varchar(100),
    contact_info text
);

-- Default Data Insertions
INSERT INTO industry (industry_name) VALUES ('Default Industry') ON CONFLICT (industry_name) DO NOTHING;
INSERT INTO category (category_name) VALUES ('Default Category') ON CONFLICT (category_name) DO NOTHING;
INSERT INTO department (name) VALUES ('Default Department') ON CONFLICT (name) DO NOTHING;
INSERT INTO designation (name) VALUES ('Default Designation') ON CONFLICT (name) DO NOTHING;

INSERT INTO company (legal_name, brand, scale, industry_id, category_id, company_type, status) 
VALUES ('Export Support India', 'ESI', 'Enterprise', 
    (SELECT industry_id FROM industry WHERE industry_name = 'Default Industry'), 
    (SELECT category_id FROM category WHERE category_name = 'Default Category'), 
    'internal', 'active') 
ON CONFLICT DO NOTHING;

INSERT INTO employee (company_id, first_name, last_name, aadhaar_number, department_id, designation_id, status) 
VALUES (
    (SELECT company_id FROM company WHERE legal_name = 'Export Support India'), 
    'Default', 'User', '9999-9999-9999', 
    (SELECT department_id FROM department WHERE name = 'Default Department'), 
    (SELECT designation_id FROM designation WHERE name = 'Default Designation'), 
    'active') 
ON CONFLICT (aadhaar_number) DO NOTHING;